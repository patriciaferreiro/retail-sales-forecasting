# Job task logs

Captured 2026-11-21 from the Jobs API (`GET /api/2.1/jobs/runs/export`, per task run). For each notebook cell: its title and the output that cell produced in the job run, as returned. Cells whose statements return no result (views, DDL) show none. Repeated Spark session notices (`pyspark.sql.connect.logging` "Effective usage policy" lines) are removed and counted; nothing else is changed.

## Job run `773601263928933` (weekly sales forecast per product) / task `run_sales_forecast`

Task run `258637739741343`, result **SUCCESS**.

### Cell 1: Stitched weekly sales per product

No output.

### Cell 2: ai_forecast: 12 weeks of unit sales per product

| num_affected_rows | num_inserted_rows |
| --- | --- |
| 552 | 552 |

### Cell 3: Holdout accuracy: forecast the last 12 weeks from before them

| num_affected_rows |
| --- |
| 0 |

| num_affected_rows | num_inserted_rows |
| --- | --- |
| 1 | 1 |

| model | holdout_start | holdout_end | products | points | wape_pct | mae_units | coverage_pct | bias_pct | evaluated_at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mlflow_lightgbm | 2026-08-24 | 2026-11-09 | 46 | 552 | 7.189686589293019 | 29.789919341364698 | 83.15217391304348 | -0.7435578259304948 | 2026-11-21T12:43:35.542Z |
| ai_forecast | 2026-08-24 | 2026-11-09 | 46 | 552 | 26.877193858285104 | 111.36360774792381 | 65.03623188405797 | 11.545454942458813 | 2026-11-21T12:44:58.672Z |

Note: at this point the `mlflow_lightgbm` row (`evaluated_at` 12:43:35) was from a developer test run of the MLflow notebook a minute earlier; the job's own `sales_forecast_mlflow` task below replaced it at 12:46:02.

## Job run `773601263928933` (weekly sales forecast per product) / task `sales_forecast_mlflow`

Task run `1081455216451481`, result **SUCCESS**.

### Cell 1: About

No output.

### Cell 2: Install LightGBM

```text
Note: you may need to restart the kernel using %restart_python or dbutils.library.restartPython() to use updated packages.
```

### Cell 3: Weekly sales per product

(3 Spark session notice lines removed.)

```text
cutoff 2026-11-09 | 46 products | 104 weeks
```

### Cell 4: Global LightGBM model and pyfunc wrapper

```text
/databricks/python/lib/python3.12/site-packages/mlflow/pyfunc/utils/data_validation.py:187: UserWarning: Add type hints to the `predict` method to enable data validation and automatic signature inference during model logging. Check https://mlflow.org/docs/latest/model/python_model.html#type-hint-usage-in-pythonmodel for more details.
  color_warning(
```

### Cell 5: Holdout accuracy, refit, log to MLflow

```text
{'model': 'mlflow_lightgbm', 'holdout_start': datetime.date(2026, 8, 24), 'holdout_end': datetime.date(2026, 11, 9), 'products': 46, 'points': 552, 'wape_pct': 7.19, 'mae_units': 29.79, 'coverage_pct': 83.15, 'bias_pct': -0.74}
```

```text
2026/11/21 12:45:51 WARNING mlflow.tracking.context.registry: Encountered unexpected error during resolving tags: getContext().extraContext() is not a CommandContext accessor, it is not available or is misspelled.
2026/11/21 12:45:51 WARNING mlflow.tracking.context.registry: Encountered unexpected error during resolving tags: getContext().extraContext() is not a CommandContext accessor, it is not available or is misspelled.
🔗 View Logged Model at: https://fevm-patricia-aws-serverless.cloud.databricks.com/ml/experiments/1951581770770268/models/m-4a71a82fdd89470093fab2536ce8911d?o=7474647099307852
2026/11/21 12:45:52 INFO mlflow.pyfunc: Validating input example against model signature
2026/11/21 12:46:00 WARNING mlflow.tracking.context.registry: Encountered unexpected error during resolving tags: getContext().extraContext() is not a CommandContext accessor, it is not available or is misspelled.
```

```text
run 10bd45f7fafc4daba0f8932c1d524bc6 | model models:/m-4a71a82fdd89470093fab2536ce8911d
```

### Cell 6: Write gold.sales_forecast_mlflow and accuracy

| model | holdout_start | holdout_end | products | points | wape_pct | mae_units | coverage_pct | bias_pct | evaluated_at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ai_forecast | 2026-08-24 | 2026-11-09 | 46 | 552 | 26.877193858285104 | 111.36360774792381 | 65.03623188405797 | 11.545454942458813 | 2026-11-21T12:44:58.672Z |
| mlflow_lightgbm | 2026-08-24 | 2026-11-09 | 46 | 552 | 7.189686589293019 | 29.789919341364698 | 83.15217391304348 | -0.7435578259304948 | 2026-11-21T12:46:02.710Z |

### Cell 7: Combined view of both models (used by the app and Genie)

| model | rows | products | first | last |
| --- | --- | --- | --- | --- |
| ai_forecast | 552 | 46 | 2026-11-16 | 2027-02-01 |
| mlflow_lightgbm | 552 | 46 | 2026-11-16 | 2027-02-01 |

## Job run `144240477916498` (launch-count forecasts) / task `run_forecast`

Task run `765778084959655`, result **SUCCESS**.

### Cell 1: Prepare time series: zero-filled history up to the cutoff, scheduled launches apart

No output.

### Cell 2: Run ai_forecast for clients with enough history

No output.

### Cell 3: Combine forecast, baseline and scheduled launches, and write to gold

| num_affected_rows | num_inserted_rows |
| --- | --- |
| 36 | 36 |

### Cell 4: Preview history, scheduled launches and forecast

| ds | client_id | actual | scheduled | forecast |
| --- | --- | --- | --- | --- |
| 2025-05-26 | Henkel | 2.0 |  |  |
| 2025-06-02 | Henkel | 1.0 |  |  |
| 2025-06-09 | Henkel | 3.0 |  |  |
| 2025-06-16 | Henkel | 3.0 |  |  |
| 2025-06-23 | Henkel | 3.0 |  |  |
| 2025-06-30 | Henkel | 2.0 |  |  |
| 2025-07-07 | Henkel | 3.0 |  |  |
| 2025-07-14 | Henkel | 3.0 |  |  |

(272 rows in total; first 8 shown.)

## Job run `144240477916498` (launch-count forecasts) / task `forecast_mlflow`

Task run `859625499501732`, result **SUCCESS**.

### Cell 1: About

No output.

### Cell 2: Install LightGBM

```text
Note: you may need to restart the kernel using %restart_python or dbutils.library.restartPython() to use updated packages.
```

### Cell 3: Parameters and weekly series

```text
cutoff 2026-11-09 | clients ['Henkel', 'NIVEA', 'Unilever'] | eligible for the model ['Henkel', 'NIVEA', 'Unilever']
```

### Cell 4: Global LightGBM (same features as the backtest)

```text
/databricks/python/lib/python3.12/site-packages/mlflow/pyfunc/utils/data_validation.py:187: UserWarning: Add type hints to the `predict` method to enable data validation and automatic signature inference during model logging. Check https://mlflow.org/docs/latest/model/python_model.html#type-hint-usage-in-pythonmodel for more details.
  color_warning(
```

```text
training rows: 195
```

### Cell 5: Log the run and model to MLflow

```text
2026/11/21 10:37:39 WARNING mlflow.tracking.context.registry: Encountered unexpected error during resolving tags: getContext().extraContext() is not a CommandContext accessor, it is not available or is misspelled.
2026/11/21 10:37:39 WARNING mlflow.tracking.context.registry: Encountered unexpected error during resolving tags: getContext().extraContext() is not a CommandContext accessor, it is not available or is misspelled.
🔗 View Logged Model at: https://fevm-patricia-aws-serverless.cloud.databricks.com/ml/experiments/1951581770770268/models/m-c9b0f6053e504f80abacdf36cc11189f?o=7474647099307852
2026/11/21 10:37:39 INFO mlflow.pyfunc: Validating input example against model signature
2026/11/21 10:37:48 WARNING mlflow.tracking.context.registry: Encountered unexpected error during resolving tags: getContext().extraContext() is not a CommandContext accessor, it is not available or is misspelled.
```

```text
run 5eb956bb6c8b42138286660cffbf105d | model models:/m-c9b0f6053e504f80abacdf36cc11189f
```

### Cell 6: Combine with baseline and scheduled launches, write gold.launch_forecasts_mlflow

| client_id | method | count |
| --- | --- | --- |
| Henkel | lightgbm_global | 12 |
| NIVEA | lightgbm_global | 12 |
| Unilever | lightgbm_global | 12 |
