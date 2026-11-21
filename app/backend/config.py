"""Runtime configuration, injected through app.yaml and app resources."""
import os

CATALOG = os.environ.get("CATALOG", "patricia_aws_serverless_catalog")
WAREHOUSE_ID = os.environ.get("DATABRICKS_WAREHOUSE_ID", "")
FORECAST_JOB_ID = int(os.environ.get("FORECAST_JOB_ID") or 0)
# Tasks the app runs: the forecast and the refresh of its Lakebase synced copy
FORECAST_TASK_KEYS = [t for t in os.environ.get("FORECAST_TASK_KEYS", "run_forecast,forecast_mlflow,sync_forecast_to_lakebase").split(",") if t]

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

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
