# Job run evidence

Captured 2026-11-21 18:08 UTC from the Jobs API (`jobs/get`, `jobs/list_runs`, `jobs/runs/get`) for job `[dev patricia_ferreiro] [dev] Product Launch Forecast Pipeline` (id `431565808481005`).

## Job definition (as deployed by the bundle)

| Task | Depends on | Notebook / pipeline | Compute |
| --- | --- | --- | --- |
| `setup_catalog` | - | `src/setup_catalog.sql` | SQL warehouse |
| `extract_product_data` | setup_catalog | `src/extraction/extract_product_data.sql` | SQL warehouse |
| `run_sales_forecast` | extract_product_data | `src/forecasting/run_sales_forecast` | SQL warehouse |
| `sales_forecast_mlflow` | run_sales_forecast | `src/forecasting/run_sales_forecast_mlflow` | serverless |
| `run_forecast` | extract_product_data | `src/forecasting/run_forecast.sql` | SQL warehouse |
| `forecast_mlflow` | extract_product_data | `src/forecasting/run_forecast_mlflow` | serverless |
| `sync_forecast_to_lakebase` | run_forecast | `synced-table pipeline (Lakebase)` | managed pipeline |

Schedule: `0 0 8 * * ?` (Europe/Madrid). Status in the dev target: `PAUSED` (development-mode bundles pause schedules; runs below were started from the app or the API).

## All recent runs

| Run id | Started (UTC) | Result | Duration |
| --- | --- | --- | --- |
| `773601263928933` | 2026-11-21 12:44:34 | SUCCESS | 1.8 min |
| `144240477916498` | 2026-11-21 10:37:05 | SUCCESS | 1.1 min |
| `1039542997674525` | 2026-11-21 10:00:30 | SUCCESS | 0.9 min |
| `1079681903676189` | 2026-11-21 09:23:15 | SUCCESS | 1.0 min |
| `205259552261520` | 2026-11-21 08:24:21 | SUCCESS | 1.0 min |
| `979676605885528` | 2026-11-20 23:15:59 | SUCCESS | 0.7 min |
| `1032565149095356` | 2026-11-20 23:10:46 | SUCCESS | 0.7 min |
| `691224338411653` | 2026-11-20 23:07:28 | SUCCESS | 1.0 min |

## Run `773601263928933`: weekly sales forecast per product (ai_forecast, then MLflow LightGBM)

Result **SUCCESS**, 2026-11-21 12:44:34 to 2026-11-21 12:46:20 UTC. Run page: https://fevm-patricia-aws-serverless.cloud.databricks.com/?o=7474647099307852#job/431565808481005/run/773601263928933

Tasks that ran (tasks not selected for this run are omitted):

| Task | Result | Started (UTC) | Ended (UTC) | Duration |
| --- | --- | --- | --- | --- |
| `run_sales_forecast` | SUCCESS | 2026-11-21 12:44:34 | 2026-11-21 12:45:09 | 35 s |
| `sales_forecast_mlflow` | SUCCESS | 2026-11-21 12:45:09 | 2026-11-21 12:46:20 | 71 s |

## Run `144240477916498`: launch-count forecasts (both models) and the Lakebase sync

Result **SUCCESS**, 2026-11-21 10:37:05 to 2026-11-21 10:38:14 UTC. Run page: https://fevm-patricia-aws-serverless.cloud.databricks.com/?o=7474647099307852#job/431565808481005/run/144240477916498

Tasks that ran (tasks not selected for this run are omitted):

| Task | Result | Started (UTC) | Ended (UTC) | Duration |
| --- | --- | --- | --- | --- |
| `run_forecast` | SUCCESS | 2026-11-21 10:37:05 | 2026-11-21 10:37:41 | 36 s |
| `forecast_mlflow` | SUCCESS | 2026-11-21 10:37:05 | 2026-11-21 10:37:57 | 52 s |
| `sync_forecast_to_lakebase` | SUCCESS | 2026-11-21 10:37:41 | 2026-11-21 10:38:13 | 32 s |

## Run `1039542997674525`: launch-count forecast after the forecast fixes, and the Lakebase sync

Result **SUCCESS**, 2026-11-21 10:00:30 to 2026-11-21 10:01:23 UTC. Run page: https://fevm-patricia-aws-serverless.cloud.databricks.com/?o=7474647099307852#job/431565808481005/run/1039542997674525

Tasks that ran (tasks not selected for this run are omitted):

| Task | Result | Started (UTC) | Ended (UTC) | Duration |
| --- | --- | --- | --- | --- |
| `run_forecast` | SUCCESS | 2026-11-21 10:00:30 | 2026-11-21 10:00:50 | 19 s |
| `sync_forecast_to_lakebase` | SUCCESS | 2026-11-21 10:00:50 | 2026-11-21 10:01:22 | 32 s |
