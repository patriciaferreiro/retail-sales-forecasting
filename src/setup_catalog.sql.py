# Databricks notebook source
# DBTITLE 1,Create dedicated project catalog
# MAGIC %sql
# MAGIC -- Use the catalog passed as job parameter
# MAGIC -- CREATE CATALOG requires metastore admin — handled externally
# MAGIC USE CATALOG ${catalog};

# COMMAND ----------

# DBTITLE 1,Create medallion schemas
# MAGIC %sql
# MAGIC -- Bronze: raw ingested documents
# MAGIC CREATE SCHEMA IF NOT EXISTS bronze;
# MAGIC
# MAGIC -- Silver: extracted and standardized product launch data
# MAGIC CREATE SCHEMA IF NOT EXISTS silver;
# MAGIC
# MAGIC -- Gold: forecast results ready for sharing
# MAGIC CREATE SCHEMA IF NOT EXISTS gold;

# COMMAND ----------

# DBTITLE 1,Create volume for raw document ingestion
# MAGIC %sql
# MAGIC -- Volume where client email attachments are dropped
# MAGIC -- (via Power Automate, Logic App, or custom integration)
# MAGIC CREATE VOLUME IF NOT EXISTS bronze.raw_documents;

# COMMAND ----------

# DBTITLE 1,Create silver table schema for standardized product launches
# MAGIC %sql
# MAGIC -- Standardized product launch table — one row per product per document
# MAGIC -- Supports multiple products per document, identifier transitions (old → new),
# MAGIC -- and multilingual extraction (German, English, etc.)
# MAGIC CREATE TABLE IF NOT EXISTS silver.product_launches (
# MAGIC   document_id STRING COMMENT 'Unique ID per product-document combination',
# MAGIC   client_id STRING COMMENT 'Client/brand name (e.g., NIVEA, Henkel)',
# MAGIC   launch_date DATE COMMENT 'Cutover/launch date',
# MAGIC   article_description STRING COMMENT 'Full product name/description',
# MAGIC   identifier_old STRING COMMENT 'Previous identifier (e.g., old GTIN)',
# MAGIC   identifier_new STRING COMMENT 'New identifier (e.g., new GTIN)',
# MAGIC   identifier_type STRING COMMENT 'Identifier type: GTIN, EAN, SKU, UPC',
# MAGIC   size STRING COMMENT 'Product size (e.g., 150ml)',
# MAGIC   packaging STRING COMMENT 'Packaging type (e.g., Dose, Tube, Flasche)',
# MAGIC   category STRING COMMENT 'Product category',
# MAGIC   notes STRING COMMENT 'Additional extraction notes',
# MAGIC   extracted_at TIMESTAMP COMMENT 'When extraction was performed',
# MAGIC   source_file STRING COMMENT 'Original file path in volume'
# MAGIC )
# MAGIC COMMENT 'Standardized product launch data — one row per product, supports identifier transitions and multi-product documents';

# COMMAND ----------

# DBTITLE 1,Create gold forecast results table
# MAGIC %sql
# MAGIC -- Forecast output table
# MAGIC CREATE TABLE IF NOT EXISTS gold.launch_forecasts (
# MAGIC   client_id STRING,
# MAGIC   ds DATE COMMENT 'Forecast time point',
# MAGIC   metric_forecast DOUBLE,
# MAGIC   metric_upper DOUBLE,
# MAGIC   metric_lower DOUBLE,
# MAGIC   forecast_generated_at TIMESTAMP
# MAGIC )
# MAGIC COMMENT 'AI-generated forecasts for product launch performance'
# MAGIC -- Change data feed lets the app's Lakebase synced table pick up new forecasts
# MAGIC TBLPROPERTIES (delta.enableChangeDataFeed = true);