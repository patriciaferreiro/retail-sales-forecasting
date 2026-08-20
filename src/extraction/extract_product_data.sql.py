# Databricks notebook source
# DBTITLE 1,Parse all documents from the raw volume
# MAGIC %sql
# MAGIC -- Step 1: Parse all documents dropped into the raw_documents volume
# MAGIC -- Handles PDFs, Word docs, images — any format clients send
# MAGIC CREATE OR REPLACE TEMPORARY VIEW parsed_documents AS
# MAGIC SELECT
# MAGIC   _metadata.file_name AS file_name,
# MAGIC   _metadata.file_path AS file_path,
# MAGIC   _metadata.file_modification_time AS received_at,
# MAGIC   ai_parse_document(content, MAP('version', '2.0')) AS parsed
# MAGIC FROM READ_FILES(
# MAGIC   '/Volumes/${catalog}/bronze/raw_documents/',
# MAGIC   format => 'binaryFile'
# MAGIC )
# MAGIC WHERE is_variant_null(ai_parse_document(content, MAP('version', '2.0')):error_status);

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

# DBTITLE 1,Write standardized data to silver table (one row per product)
# MAGIC %sql
# MAGIC -- Step 3: Explode products array into one row per product, insert into silver
# MAGIC INSERT INTO ${catalog}.silver.product_launches
# MAGIC SELECT
# MAGIC   md5(concat(file_path, product:article_description::STRING)) AS document_id,
# MAGIC   extracted:client_name::STRING AS client_id,
# MAGIC   product:article_description::STRING AS article_description,
# MAGIC   TRY_CAST(extracted:launch_date::STRING AS DATE) AS launch_date,
# MAGIC   MAP(
# MAGIC     'identifier_type', COALESCE(product:identifier_type::STRING, ''),
# MAGIC     'identifier_old', COALESCE(product:identifier_old::STRING, ''),
# MAGIC     'identifier_new', COALESCE(product:identifier_new::STRING, '')
# MAGIC   ) AS identifiers,
# MAGIC   MAP(
# MAGIC     'category', COALESCE(product:category::STRING, ''),
# MAGIC     'size', COALESCE(product:size::STRING, ''),
# MAGIC     'packaging', COALESCE(product:packaging::STRING, '')
# MAGIC   ) AS characteristics,
# MAGIC   current_timestamp() AS extracted_at,
# MAGIC   file_path AS source_file
# MAGIC FROM extracted_launches
# MAGIC LATERAL VIEW EXPLODE(
# MAGIC   TRY_CAST(extracted:products AS ARRAY<VARIANT>)
# MAGIC ) AS product
# MAGIC WHERE product:article_description IS NOT NULL;

# COMMAND ----------

# DBTITLE 1,Verify extraction results
# MAGIC %sql
# MAGIC -- Quick validation: check what was extracted
# MAGIC SELECT
# MAGIC   client_id,
# MAGIC   article_description,
# MAGIC   launch_date,
# MAGIC   identifiers,
# MAGIC   characteristics
# MAGIC FROM ${catalog}.silver.product_launches
# MAGIC ORDER BY extracted_at DESC
# MAGIC LIMIT 20;