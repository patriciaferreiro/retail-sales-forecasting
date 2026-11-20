# Databricks notebook source
# DBTITLE 1,Parse new documents from the raw volume
# MAGIC %sql
# MAGIC -- Step 1: Parse documents dropped into the raw_documents volume
# MAGIC -- Handles PDFs, Word docs, images — any format clients send
# MAGIC -- Only files not yet in silver are parsed, and ai_parse_document runs once per file
# MAGIC CREATE OR REPLACE TEMPORARY VIEW parsed_documents AS
# MAGIC WITH new_files AS (
# MAGIC   SELECT
# MAGIC     f._metadata.file_name AS file_name,
# MAGIC     f._metadata.file_path AS file_path,
# MAGIC     f._metadata.file_modification_time AS received_at,
# MAGIC     f.content
# MAGIC   FROM READ_FILES(
# MAGIC     '/Volumes/${catalog}/bronze/raw_documents/',
# MAGIC     format => 'binaryFile'
# MAGIC   ) AS f
# MAGIC   WHERE NOT EXISTS (
# MAGIC     SELECT 1 FROM ${catalog}.silver.product_launches s
# MAGIC     WHERE s.source_file = f._metadata.file_path
# MAGIC   )
# MAGIC ),
# MAGIC parsed_files AS (
# MAGIC   SELECT
# MAGIC     file_name,
# MAGIC     file_path,
# MAGIC     received_at,
# MAGIC     ai_parse_document(content, MAP('version', '2.0')) AS parsed
# MAGIC   FROM new_files
# MAGIC )
# MAGIC SELECT * FROM parsed_files
# MAGIC WHERE is_variant_null(parsed:error_status);

# COMMAND ----------

# DBTITLE 1,Extract structured product launch fields using AI
# MAGIC %sql
# MAGIC -- Step 2: Extract standardized fields from parsed documents
# MAGIC -- Revised schema: supports multiple products per document, identifier changes, multilingual
# MAGIC CREATE OR REPLACE TEMPORARY VIEW extracted_launches AS
# MAGIC SELECT
# MAGIC   file_name,
# MAGIC   file_path,
# MAGIC   received_at,
# MAGIC   ai_extract(
# MAGIC     parsed,
# MAGIC     '{
# MAGIC       "client_name": {"type": "string", "description": "Name of the brand or client"},
# MAGIC       "launch_date": {"type": "string", "description": "Cutover/launch date in YYYY-MM-DD format. Look for dates, KWLT (Kalenderwoche Liefertermin), or similar"},
# MAGIC       "products": {
# MAGIC         "type": "array",
# MAGIC         "description": "All products listed in the document",
# MAGIC         "items": {
# MAGIC           "type": "object",
# MAGIC           "properties": {
# MAGIC             "article_description": {"type": "string", "description": "Full product name/description"},
# MAGIC             "identifier_old": {"type": "string", "description": "Previous/old identifier (GTIN ALT, old SKU, old EAN)"},
# MAGIC             "identifier_new": {"type": "string", "description": "New identifier (GTIN NEU, new SKU, new EAN)"},
# MAGIC             "identifier_type": {"type": "string", "description": "Type of identifier: GTIN, EAN, SKU, UPC, etc."},
# MAGIC             "size": {"type": "string", "description": "Product size or volume"},
# MAGIC             "packaging": {"type": "string", "description": "Packaging type (Dose, Tube, Flasche, etc.)"},
# MAGIC             "category": {"type": "string", "description": "Product category"}
# MAGIC           }
# MAGIC         }
# MAGIC       },
# MAGIC       "notes": {"type": "string", "description": "Any additional instructions or context from the document"}
# MAGIC     }',
# MAGIC     MAP(
# MAGIC       'version', '2.1',
# MAGIC       'instructions', 'Extract product launch/changeover information. Documents may be in German or other languages. They often describe GTIN changes, new product introductions, or identifier transitions. Extract ALL products listed. Dates may be in DD.MM.YYYY or other European formats — normalize to YYYY-MM-DD.'
# MAGIC     )
# MAGIC   ) AS extracted
# MAGIC FROM parsed_documents;

# COMMAND ----------

# DBTITLE 1,Merge standardized data into silver table (one row per product)
# MAGIC %sql
# MAGIC -- Step 3: Explode products array into one row per product, merge into silver
# MAGIC -- MERGE on document_id keeps reruns idempotent (no duplicate rows)
# MAGIC MERGE INTO ${catalog}.silver.product_launches AS t
# MAGIC USING (
# MAGIC SELECT
# MAGIC   md5(concat(source_file, article_description)) AS document_id,
# MAGIC   client_id, launch_date, article_description, identifier_old, identifier_new,
# MAGIC   identifier_type, size, packaging, category, notes, extracted_at, source_file
# MAGIC FROM (
# MAGIC   -- ai_extract v2.1 returns {response: {field: {value: ...}}, error_message, metadata}.
# MAGIC   -- Unwrap .value whenever the field is an object (value may be null); plain values pass through.
# MAGIC   SELECT
# MAGIC     CASE WHEN schema_of_variant(x:client_name) LIKE 'OBJECT%' THEN x:client_name:value::STRING ELSE x:client_name::STRING END AS client_id,
# MAGIC     TRY_CAST(CASE WHEN schema_of_variant(x:launch_date) LIKE 'OBJECT%' THEN x:launch_date:value::STRING ELSE x:launch_date::STRING END AS DATE) AS launch_date,
# MAGIC     CASE WHEN schema_of_variant(product:article_description) LIKE 'OBJECT%' THEN product:article_description:value::STRING ELSE product:article_description::STRING END AS article_description,
# MAGIC     CASE WHEN schema_of_variant(product:identifier_old) LIKE 'OBJECT%' THEN product:identifier_old:value::STRING ELSE product:identifier_old::STRING END AS identifier_old,
# MAGIC     CASE WHEN schema_of_variant(product:identifier_new) LIKE 'OBJECT%' THEN product:identifier_new:value::STRING ELSE product:identifier_new::STRING END AS identifier_new,
# MAGIC     CASE WHEN schema_of_variant(product:identifier_type) LIKE 'OBJECT%' THEN product:identifier_type:value::STRING ELSE product:identifier_type::STRING END AS identifier_type,
# MAGIC     CASE WHEN schema_of_variant(product:size) LIKE 'OBJECT%' THEN product:size:value::STRING ELSE product:size::STRING END AS size,
# MAGIC     CASE WHEN schema_of_variant(product:packaging) LIKE 'OBJECT%' THEN product:packaging:value::STRING ELSE product:packaging::STRING END AS packaging,
# MAGIC     CASE WHEN schema_of_variant(product:category) LIKE 'OBJECT%' THEN product:category:value::STRING ELSE product:category::STRING END AS category,
# MAGIC     CASE WHEN schema_of_variant(x:notes) LIKE 'OBJECT%' THEN x:notes:value::STRING ELSE x:notes::STRING END AS notes,
# MAGIC     current_timestamp() AS extracted_at,
# MAGIC     file_path AS source_file
# MAGIC   FROM (SELECT file_path, COALESCE(extracted:response, extracted) AS x FROM extracted_launches)
# MAGIC   LATERAL VIEW EXPLODE(TRY_CAST(x:products AS ARRAY<VARIANT>)) AS product
# MAGIC ) AS p
# MAGIC WHERE article_description IS NOT NULL
# MAGIC -- A document can list the same product twice; keep one row per document_id
# MAGIC QUALIFY ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY extracted_at DESC) = 1
# MAGIC ) AS s
# MAGIC ON t.document_id = s.document_id
# MAGIC WHEN MATCHED THEN UPDATE SET *
# MAGIC WHEN NOT MATCHED THEN INSERT *;

# COMMAND ----------

# DBTITLE 1,Verify extraction results
# MAGIC %sql
# MAGIC -- Quick validation: check what was extracted
# MAGIC SELECT
# MAGIC   client_id,
# MAGIC   article_description,
# MAGIC   launch_date,
# MAGIC   identifier_old,
# MAGIC   identifier_new,
# MAGIC   identifier_type,
# MAGIC   size,
# MAGIC   packaging,
# MAGIC   category
# MAGIC FROM ${catalog}.silver.product_launches
# MAGIC ORDER BY extracted_at DESC
# MAGIC LIMIT 20;