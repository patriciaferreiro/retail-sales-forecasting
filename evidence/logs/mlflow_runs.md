# MLflow training run records

Captured 2026-11-21 with the MLflow client (`get_run`, `list_artifacts`, `get_logged_model`) from experiment `/Users/patricia.ferreiro@databricks.com/launch-forecast-comparison` (id `1951581770770268`). The training notebooks don't write a separate training log; MLflow records the run (parameters, metrics, tags) and the logged model. The training code's console output is in [job_task_logs.md](job_task_logs.md).

## Run `10bd45f7fafc4daba0f8932c1d524bc6`: sales model, from job run `773601263928933`

| Field | Value |
| --- | --- |
| Run name | `sales_forecast_mlflow 2026-11-09` |
| Status | `FINISHED` |
| Duration | 9 s |
| Source | `mlflow.source.type = JOB`, `mlflow.source.name = jobs/431565808481005/run/1081455216451481` |
| Job / task run | `mlflow.databricks.jobID = 431565808481005`, `mlflow.databricks.jobRunID = 1081455216451481` |
| Notebook | `/Users/patricia.ferreiro@databricks.com/retail-sales-forecasting/src/forecasting/run_sales_forecast_mlflow` |
| User | `patricia.ferreiro@databricks.com` (the job's run-as identity) |
| Custom tags | `method = lightgbm_global`, `project = product-launch-forecast`, `target = weekly unit sales per product` |

Metrics, as logged:

| metric | value |
| --- | --- |
| holdout_wape_pct | 7.189686589293019 |
| holdout_mae_units | 29.789919341364698 |
| holdout_coverage_pct | 83.15217391304348 |
| holdout_bias_pct | -0.7435578259304948 |

Parameters are listed in [../forecasts.md](../forecasts.md) (lags `[12, 13, 14, 26, 52]`, 300 trees, learning rate 0.05, 15 leaves, 4,232 training rows, 46 products, cutoff 2026-11-09).

### Logged model `m-4a71a82fdd89470093fab2536ce8911d`

Name `model`, status `READY`, `source_run_id = 10bd45f7fafc4daba0f8932c1d524bc6`, created 2026-11-21 12:45:51 UTC. The run has no artifacts of its own: with MLflow 3 the model is stored as a separate logged model.

| File | Bytes |
| --- | --- |
| artifacts/MLmodel | 1362 |
| artifacts/conda.yaml | 232 |
| artifacts/input_example.json | 254 |
| artifacts/python_env.yaml | 120 |
| artifacts/python_model.pkl | 1494439 |
| artifacts/requirements.txt | 113 |
| artifacts/serving_input_example.json | 465 |
| metadata/MLmodel | 1362 |
| metadata/conda.yaml | 232 |
| metadata/python_env.yaml | 120 |
| metadata/requirements.txt | 113 |

## Run `5eb956bb6c8b42138286660cffbf105d`: launch-count model, from job run `144240477916498`

| Field | Value |
| --- | --- |
| Run name | `forecast_mlflow 2026-11-09` |
| Status | `FINISHED` |
| Duration | 9 s |
| Source | `mlflow.source.type = JOB`, `mlflow.source.name = jobs/431565808481005/run/859625499501732` |
| Job / task run | `mlflow.databricks.jobID = 431565808481005`, `mlflow.databricks.jobRunID = 859625499501732` |
| Notebook | `/Users/patricia.ferreiro@databricks.com/retail-sales-forecasting/src/forecasting/run_forecast_mlflow` |
| User | `patricia.ferreiro@databricks.com` |
| Custom tags | `method = lightgbm_global`, `project = product-launch-forecast`, `purpose = production forecast` |

Metrics: none. This notebook logs parameters and the model but no metrics; its accuracy comes from the backtest in `src/forecasting/forecast_exploration`.

### Logged model `m-c9b0f6053e504f80abacdf36cc11189f`

Name `model`, status `READY`, `source_run_id = 5eb956bb6c8b42138286660cffbf105d`, created 2026-11-21 10:37:39 UTC.

| File | Bytes |
| --- | --- |
| artifacts/MLmodel | 1357 |
| artifacts/conda.yaml | 232 |
| artifacts/input_example.json | 217 |
| artifacts/python_env.yaml | 120 |
| artifacts/python_model.pkl | 508263 |
| artifacts/requirements.txt | 113 |
| artifacts/serving_input_example.json | 428 |
| metadata/MLmodel | 1357 |
| metadata/conda.yaml | 232 |
| metadata/python_env.yaml | 120 |
| metadata/requirements.txt | 113 |

## Warnings seen during training (from the job task logs)

* `UserWarning: Add type hints to the predict method ...`: the pyfunc wrapper has no type hints; logging still validated the input example against the signature.
* `WARNING mlflow.tracking.context.registry: Encountered unexpected error during resolving tags: getContext().extraContext() ...`: MLflow couldn't read one optional notebook context tag on serverless; the run's job tags above were still recorded.
