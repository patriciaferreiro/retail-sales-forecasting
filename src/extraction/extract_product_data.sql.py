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
# MAGIC -- ai_extract handles wildly different formats from each client
# MAGIC CREATE OR REPLACE TEMPORARY VIEW extracted_launches AS
# MAGIC SELECT
# MAGIC   file_name,
# MAGIC   file_path,
# MAGIC   received_at,
# MAGIC   ai_extract(
# MAGIC     parsed,
# MAGIC     '{
# MAGIC       "article_description": {"type": "string", "description": "Full description of the product or article being launched"},
# MAGIC       "launch_date": {"type": "string", "description": "Planned launch date in YYYY-MM-DD format"},
# MAGIC       "client_name": {"type": "string", "description": "Name of the client or brand launching the product"},
# MAGIC       "identifiers": {
# MAGIC         "type": "object",
# MAGIC         "description": "All product identifiers found (SKU, EAN, UPC, GTIN, internal codes)",
# MAGIC         "properties": {
# MAGIC           "sku": {"type": "string"},
# MAGIC           "ean": {"type": "string"},
# MAGIC           "upc": {"type": "string"},
# MAGIC           "internal_code": {"type": "string"}
# MAGIC         }
# MAGIC       },
# MAGIC       "characteristics": {
# MAGIC         "type": "object",
# MAGIC         "description": "Product characteristics (size, weight, color, material, category, subcategory)",
# MAGIC         "properties": {
# MAGIC           "category": {"type": "string"},
# MAGIC           "subcategory": {"type": "string"},
# MAGIC           "size": {"type": "string"},
# MAGIC           "weight": {"type": "string"},
# MAGIC           "color": {"type": "string"},
# MAGIC           "material": {"type": "string"}
# MAGIC         }
# MAGIC       }
# MAGIC     }',
# MAGIC     MAP(
# MAGIC       'version', '2.1',
# MAGIC       'instructions', 'Extract product launch information. Each document describes one or more new products being launched. Dates may be in various formats — normalize to YYYY-MM-DD. Identifiers may use different naming conventions per client.'
# MAGIC     )
# MAGIC   ) AS extracted
# MAGIC FROM parsed_documents;

# COMMAND ----------

# DBTITLE 1,Write standardized data to silver table
# MAGIC %sql
# MAGIC -- Step 3: Insert extracted data into the standardized silver table
# MAGIC INSERT INTO ${catalog}.silver.product_launches
# MAGIC SELECT
# MAGIC   md5(file_path) AS document_id,
# MAGIC   extracted:client_name::STRING AS client_id,
# MAGIC   extracted:article_description::STRING AS article_description,
# MAGIC   TRY_CAST(extracted:launch_date::STRING AS DATE) AS launch_date,
# MAGIC   MAP(
# MAGIC     'sku', COALESCE(extracted:identifiers:sku::STRING, ''),
# MAGIC     'ean', COALESCE(extracted:identifiers:ean::STRING, ''),
# MAGIC     'upc', COALESCE(extracted:identifiers:upc::STRING, ''),
# MAGIC     'internal_code', COALESCE(extracted:identifiers:internal_code::STRING, '')
# MAGIC   ) AS identifiers,
# MAGIC   MAP(
# MAGIC     'category', COALESCE(extracted:characteristics:category::STRING, ''),
# MAGIC     'subcategory', COALESCE(extracted:characteristics:subcategory::STRING, ''),
# MAGIC     'size', COALESCE(extracted:characteristics:size::STRING, ''),
# MAGIC     'weight', COALESCE(extracted:characteristics:weight::STRING, ''),
# MAGIC     'color', COALESCE(extracted:characteristics:color::STRING, ''),
# MAGIC     'material', COALESCE(extracted:characteristics:material::STRING, '')
# MAGIC   ) AS characteristics,
# MAGIC   current_timestamp() AS extracted_at,
# MAGIC   file_path AS source_file
# MAGIC FROM extracted_launches
# MAGIC WHERE extracted:article_description IS NOT NULL;

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