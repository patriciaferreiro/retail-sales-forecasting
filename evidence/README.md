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

## How to read and reproduce

* SQL blocks can be rerun as-is in a notebook or the SQL editor on `patricia_aws_serverless_catalog`.
* Job runs, MLflow runs and Genie conversations are named by id, so they can be opened in the workspace.
* Genie and API checks ran as the developer; the cached Genie insights in `app.md` were written by the app's own service principal.

## What this evidence does not prove

* **Synthetic data:** sales and most launch history are synthetic (see `data_checks.md`). The results show the pipeline and the methods work, not real-world effect sizes.
* **Value:** the business value is an illustrative estimate from stated assumptions, not a measured result.
* **UI:** the app's screens were not captured. These files cover its deployment and API, not what the pages look like.

## Why not notebook outputs

The notebooks in `src/` are committed without outputs: committing `.ipynb` outputs needs a workspace admin setting (off by default) and a `.databricks/commit_outputs` file, and the outputs are stored as JSON, which is hard to read. These Markdown files carry the same results in readable form.
