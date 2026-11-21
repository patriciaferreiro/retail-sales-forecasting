# Evidence that the build ran

Plain-text records from the real runs of this project in the dev workspace, captured on **2026-11-21 at 18:08 UTC**. Each file shows the query, API call or command, and its output pasted as returned. Nothing here is a mock-up.

| File | What it proves | Captured from |
| --- | --- | --- |
| [jobs.md](jobs.md) | The Lakeflow Job is deployed with 7 tasks and its runs succeeded, with per-task timings | Jobs API |
| [data_checks.md](data_checks.md) | The tables are populated, old and new GTIN sales combine without loss or duplicates, and both forecasts are complete and valid | SQL on Unity Catalog |
| [forecasts.md](forecasts.md) | Holdout accuracy of both models, a sample 12-week forecast, and the MLflow run (parameters and metrics) the job produced | SQL and the MLflow tracking server |
| [changeover_impact.md](changeover_impact.md) | The changeover analysis recovers the planted effects: 1.77 points average error, 6 of 6 inside their 95% ranges | SQL, joined to the synthetic answer key |
| [value_model.md](value_model.md) | The business-value estimate (EUR 689,677 a year base case) and every assumption behind it | SQL on the value model |
| [genie.md](genie.md) | Genie answers questions on the governed tables with the SQL it ran, including one wrong answer, why it was wrong, the fix, and the corrected answers | Genie Conversation API |
| [app.md](app.md) | The app is deployed with its resources, its API returns the expected data, and the Genie insights cache is filled by the app | Apps API, the app's backend, Lakebase |

## Run logs

| File | What it shows | Captured from |
| --- | --- | --- |
| [logs/job_task_logs.md](logs/job_task_logs.md) | What every notebook cell printed or returned in the job runs: rows written, accuracy tables, training output, MLflow run and model ids | Jobs API run export, per task run |
| [logs/mlflow_runs.md](logs/mlflow_runs.md) | The two training runs the job created (tags linking them to the job, metrics) and their logged models (status, files) | MLflow client |
| [logs/app_logs.md](logs/app_logs.md) | The app's build and startup log, a browser session's requests, and the one error in the log (a stale Lakebase connection) with its traceback and cause | `databricks apps logs` |

## How to read and reproduce

* SQL blocks can be rerun as-is in a notebook or the SQL editor on `patricia_aws_serverless_catalog`.
* Job runs, MLflow runs and Genie conversations are named by id, so they can be opened in the workspace.
* Genie and API checks ran as the developer; the cached Genie insights in `app.md` were written by the app's own service principal.

## What this evidence does not prove

* **Synthetic data:** sales and most launch history are synthetic (see `data_checks.md`). The results show the pipeline and the methods work, not real-world effect sizes.
* **Value:** the business value is an illustrative estimate from stated assumptions, not a measured result.
* **UI:** the app's screens were not captured. These files cover its deployment and API, not what the pages look like.

## Why not notebook outputs

The notebooks in `src/` are committed without outputs: committing `.ipynb` outputs needs a workspace admin setting (off by default) and a `.databricks/commit_outputs` file, and the outputs are stored as JSON, which is hard to read. Job runs also don't write outputs back to the notebooks in the repo. [logs/job_task_logs.md](logs/job_task_logs.md) carries the outputs of the actual job runs as readable text instead.

## Known issues found in the logs

* **Stale Lakebase connection (app):** after a long idle period, the first `GET /api/uploads` can fail once with a 500 (`psycopg.errors.AdminShutdown`), because Lakebase suspends after 300 s idle and the connection pool hands out the closed connection. The retry succeeds. Not yet fixed. See [logs/app_logs.md](logs/app_logs.md).
* **Harmless warnings:** MLflow notes the model wrapper has no type hints and can't read one optional notebook tag on serverless; the SDK falls back to default file endpoints after a 403; the front-end bundle is over 500 kB; `npm audit` reports 2 findings in build dependencies.
