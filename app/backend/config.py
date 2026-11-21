"""Runtime configuration, injected through app.yaml and app resources."""
import os

CATALOG = os.environ.get("CATALOG", "patricia_aws_serverless_catalog")
WAREHOUSE_ID = os.environ.get("DATABRICKS_WAREHOUSE_ID", "")
FORECAST_JOB_ID = int(os.environ.get("FORECAST_JOB_ID") or 0)
# Tasks the app runs: the forecast and the refresh of its Lakebase synced copy
FORECAST_TASK_KEYS = [t for t in os.environ.get("FORECAST_TASK_KEYS", "run_sales_forecast,sales_forecast_mlflow").split(",") if t]
# Genie space behind the Ask Genie panel (injected by the genie-space app resource)
GENIE_SPACE_ID = os.environ.get("GENIE_SPACE_ID", "")

# Lakebase (Postgres). PGHOST/PGUSER/... are injected by the postgres app resource.
LAKEBASE_ENDPOINT = os.environ.get("LAKEBASE_ENDPOINT", "")
DB_SCHEMA = os.environ.get("APP_DB_SCHEMA", "review")
# Postgres schema.table of the synced copy of gold.launch_forecasts (optional)
FORECAST_SYNCED_TABLE = os.environ.get("FORECAST_SYNCED_TABLE", "")

VOLUME_ROOT = f"/Volumes/{CATALOG}/bronze/raw_documents"
UPLOAD_ROOT = f"{VOLUME_ROOT}/uploads"
SILVER_TABLE = f"{CATALOG}.silver.product_launches"
GOLD_TABLE = f"{CATALOG}.gold.launch_forecasts"
MLFLOW_FORECAST_TABLE = f"{CATALOG}.gold.launch_forecasts_mlflow"
ACCURACY_TABLE = f"{CATALOG}.gold.launch_forecast_accuracy"
CHANGEOVER_IMPACT_TABLE = f"{CATALOG}.gold.changeover_impact"
CHANGEOVER_WEEKLY_TABLE = f"{CATALOG}.gold.changeover_weekly"
SALES_FORECAST_VIEW = f"{CATALOG}.gold.sales_forecast"
PRODUCT_WEEKLY_SALES_VIEW = f"{CATALOG}.gold.product_weekly_sales"
SALES_ACCURACY_TABLE = f"{CATALOG}.gold.sales_forecast_accuracy"

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
