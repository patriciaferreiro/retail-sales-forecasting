# Forecast and model evidence

Captured 2026-11-21 18:08 UTC. Query results from `patricia_aws_serverless_catalog` and run data from the MLflow tracking server.

### Holdout accuracy: the last 12 weeks forecast without seeing them

```sql
SELECT model, holdout_start, holdout_end, products, points, ROUND(wape_pct, 2) AS wape_pct, ROUND(mae_units, 1) AS mae_units,
       ROUND(coverage_pct, 1) AS coverage_90pct_range, ROUND(bias_pct, 2) AS bias_pct, evaluated_at
FROM patricia_aws_serverless_catalog.gold.sales_forecast_accuracy ORDER BY wape_pct
```

| model | holdout_start | holdout_end | products | points | wape_pct | mae_units | coverage_90pct_range | bias_pct | evaluated_at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mlflow_lightgbm | 2026-08-24 | 2026-11-09 | 46 | 552 | 7.19 | 29.8 | 83.2 | -0.74 | 2026-11-21 12:46:02.710284 |
| ai_forecast | 2026-08-24 | 2026-11-09 | 46 | 552 | 26.88 | 111.4 | 65.0 | 11.55 | 2026-11-21 12:44:58.672562 |

WAPE = total absolute error / total actual units (lower is better). Coverage = share of actual weeks inside the 90% range.

### Sample model output: Dove Original Deo Spray 150ml, both models, next 12 weeks, next to the same weeks last year

```sql
SELECT f.week, ROUND(MAX(CASE WHEN f.model = 'mlflow_lightgbm' THEN f.forecast_units END)) AS mlflow_forecast,
       ROUND(MAX(CASE WHEN f.model = 'mlflow_lightgbm' THEN f.lower_units END)) AS mlflow_low90,
       ROUND(MAX(CASE WHEN f.model = 'mlflow_lightgbm' THEN f.upper_units END)) AS mlflow_high90,
       ROUND(MAX(CASE WHEN f.model = 'ai_forecast' THEN f.forecast_units END)) AS ai_forecast,
       MAX(ly.units) AS actual_same_week_last_year
FROM patricia_aws_serverless_catalog.gold.sales_forecast f
LEFT JOIN patricia_aws_serverless_catalog.gold.product_weekly_sales ly ON ly.product_key = f.product_key AND ly.week = date_sub(f.week, 364)
WHERE f.product_key = '8710400100058' GROUP BY f.week ORDER BY f.week
```

| week | mlflow_forecast | mlflow_low90 | mlflow_high90 | ai_forecast | actual_same_week_last_year |
| --- | --- | --- | --- | --- | --- |
| 2026-11-16 | 290.0 | 221.0 | 351.0 | 388.0 | 272 |
| 2026-11-23 | 267.0 | 216.0 | 333.0 | 391.0 | 211 |
| 2026-11-30 | 312.0 | 227.0 | 351.0 | 394.0 | 276 |
| 2026-12-07 | 300.0 | 226.0 | 352.0 | 398.0 | 263 |
| 2026-12-14 | 301.0 | 226.0 | 354.0 | 401.0 | 268 |
| 2026-12-21 | 292.0 | 222.0 | 334.0 | 404.0 | 217 |
| 2026-12-28 | 268.0 | 218.0 | 333.0 | 407.0 | 206 |
| 2027-01-04 | 247.0 | 223.0 | 344.0 | 410.0 | 223 |
| 2027-01-11 | 246.0 | 223.0 | 365.0 | 414.0 | 237 |
| 2027-01-18 | 244.0 | 219.0 | 332.0 | 417.0 | 216 |
| 2027-01-25 | 264.0 | 223.0 | 348.0 | 420.0 | 273 |
| 2027-02-01 | 244.0 | 214.0 | 332.0 | 424.0 | 222 |

### Latest MLflow run of the sales model

Experiment `/Users/patricia.ferreiro@databricks.com/launch-forecast-comparison` (id `1951581770770268`), run `sales_forecast_mlflow 2026-11-09` (run id `10bd45f7fafc4daba0f8932c1d524bc6`), status `FINISHED`, started 2026-11-21 12:45 UTC.

| parameter | value |
| --- | --- |
| lags | [12, 13, 14, 26, 52] |
| horizon_weeks | 12 |
| lgb_random_state | 42 |
| lgb_learning_rate | 0.05 |
| lgb_num_leaves | 15 |
| n_train | 4232 |
| cutoff | 2026-11-09 |
| products | 46 |
| lgb_verbose | -1 |
| lgb_min_child_samples | 10 |
| lgb_n_estimators | 300 |

| metric | value |
| --- | --- |
| holdout_coverage_pct | 83.152 |
| holdout_mae_units | 29.79 |
| holdout_wape_pct | 7.19 |
| holdout_bias_pct | -0.744 |

### All recent runs in the experiment

| run_name | run_id | status | start_time |
| --- | --- | --- | --- |
| sales_forecast_mlflow 2026-11-09 (job run 773601263928933) | 10bd45f7fafc4daba0f8932c1d524bc6 | FINISHED | 2026-11-21 12:45 |
| sales_forecast_mlflow 2026-11-09 (developer test of the same notebook) | 59667fa05c5648e08fa598c093117414 | FINISHED | 2026-11-21 12:43 |
| forecast_mlflow 2026-11-09 | 5eb956bb6c8b42138286660cffbf105d | FINISHED | 2026-11-21 10:37 |
| forecast_mlflow 2026-11-09 | 16408e6ef1544c328f83f4c33f8d7bf5 | FINISHED | 2026-11-21 10:25 |
| lightgbm_global | 6cdc777f40284ee792860a8cff7e40a1 | FINISHED | 2026-11-21 09:45 |
| ai_forecast_v2 | 56ff7bc5580b47189195d393401c4622 | FINISHED | 2026-11-21 09:45 |
| ai_forecast_current | 942814e5f10f41ffa6493b07193e3164 | FINISHED | 2026-11-21 09:45 |
| mean_8w | 2ae7197756704fa7b412d32b70a50224 | FINISHED | 2026-11-21 09:45 |
| seasonal_naive | 308db578987c490db03832b3be54fd02 | FINISHED | 2026-11-21 09:45 |

The last five runs are the launch-count backtest from `src/forecasting/forecast_exploration`. The two `forecast_mlflow` runs are the launch-count LightGBM notebook: 10:37 is job run `144240477916498`, 10:25 is a developer test of the same notebook.
