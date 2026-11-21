# Databricks notebook source
# DBTITLE 1,Prepare time series: zero-filled history up to the cutoff, scheduled launches apart
# MAGIC %sql
# MAGIC -- Weekly launches per client (Monday-based weeks). See src/forecasting/forecast_exploration for the backtest behind these choices.
# MAGIC -- Cutoff = last complete Monday-week before today. Launch dates are announced ahead, so weeks after the
# MAGIC -- cutoff are *scheduled* launches (known in advance), not history.
# MAGIC CREATE OR REPLACE TEMPORARY VIEW forecast_params AS
# MAGIC SELECT date_sub(CAST(DATE_TRUNC('week', current_date()) AS DATE), 7) AS cutoff, 12 AS horizon_weeks, 8 AS min_history_weeks;
# MAGIC
# MAGIC CREATE OR REPLACE TEMPORARY VIEW weekly_launches AS
# MAGIC SELECT client_id, CAST(DATE_TRUNC('week', launch_date) AS DATE) AS ds, COUNT(*) AS n_launches
# MAGIC FROM ${catalog}.silver.product_launches
# MAGIC WHERE launch_date IS NOT NULL AND client_id IS NOT NULL
# MAGIC GROUP BY 1, 2;
# MAGIC
# MAGIC -- History: every week from the client's first week to the cutoff, 0 when there were no launches
# MAGIC -- (ai_forecast does not fill missing weeks with 0 itself)
# MAGIC CREATE OR REPLACE TEMPORARY VIEW launch_timeseries AS
# MAGIC WITH bounds AS (
# MAGIC   SELECT w.client_id, MIN(w.ds) AS first_ds FROM weekly_launches w, forecast_params p WHERE w.ds <= p.cutoff GROUP BY w.client_id
# MAGIC ),
# MAGIC spine AS (
# MAGIC   SELECT b.client_id, explode(sequence(b.first_ds, p.cutoff, INTERVAL 1 WEEK)) AS ds FROM bounds b CROSS JOIN forecast_params p
# MAGIC )
# MAGIC SELECT s.client_id, CAST(s.ds AS TIMESTAMP) AS ds, CAST(COALESCE(w.n_launches, 0) AS DOUBLE) AS n_launches
# MAGIC FROM spine s LEFT JOIN weekly_launches w ON w.client_id = s.client_id AND w.ds = s.ds;
# MAGIC
# MAGIC CREATE OR REPLACE TEMPORARY VIEW scheduled_launches AS
# MAGIC SELECT w.client_id, w.ds, w.n_launches FROM weekly_launches w, forecast_params p WHERE w.ds > p.cutoff;

# COMMAND ----------

# DBTITLE 1,Run ai_forecast for clients with enough history
# MAGIC %sql
# MAGIC -- 12-week forecast per client, for clients with at least min_history_weeks of history
# MAGIC -- (settings kept: best ai_forecast variant in the backtest; v2 under-covered its 90% interval)
# MAGIC -- Recommendation: a global LightGBM model tracked in MLflow scored better in the backtest (holdout MASE 2.03 vs 2.45).
# MAGIC -- Switching to it needs Unity Catalog registration and a Python job task; see forecast_exploration.
# MAGIC CREATE OR REPLACE TEMPORARY VIEW forecast_eligible AS
# MAGIC SELECT client_id FROM launch_timeseries GROUP BY client_id HAVING COUNT(*) >= (SELECT min_history_weeks FROM forecast_params);
# MAGIC
# MAGIC CREATE OR REPLACE TEMPORARY VIEW forecasted_launches AS
# MAGIC SELECT * FROM ai_forecast(
# MAGIC   TABLE(SELECT * FROM launch_timeseries WHERE client_id IN (SELECT client_id FROM forecast_eligible)),
# MAGIC   -- same horizon for every client: the 12 weeks after the cutoff (right-exclusive, so +1 day)
# MAGIC   horizon => (SELECT CAST(date_add(cutoff, 7 * horizon_weeks + 1) AS TIMESTAMP) FROM forecast_params),
# MAGIC   time_col => 'ds',
# MAGIC   value_col => 'n_launches',
# MAGIC   group_col => 'client_id',
# MAGIC   prediction_interval_width => 0.90,
# MAGIC   -- Monday-anchored weeks, matching DATE_TRUNC('week', ...) on the actuals ('W' = weeks ending Sunday)
# MAGIC   frequency => 'W-MON',
# MAGIC   parameters => '{"global_floor": 0}'
# MAGIC );

# COMMAND ----------

# DBTITLE 1,Combine forecast, baseline and scheduled launches, and write to gold
# MAGIC %sql
# MAGIC -- Every client gets exactly the 12 weeks after the cutoff (no NULL rows):
# MAGIC --   * ai_forecast for clients with enough history
# MAGIC --   * otherwise the mean of the last 8 history weeks (0 when there is no history)
# MAGIC --   * announced (scheduled) launches are a floor: a week can't have fewer launches than already announced
# MAGIC CREATE OR REPLACE TEMPORARY VIEW final_forecast AS
# MAGIC WITH grid AS (
# MAGIC   SELECT c.client_id, date_add(p.cutoff, 7 * k) AS ds
# MAGIC   FROM (SELECT DISTINCT client_id FROM weekly_launches) c
# MAGIC   CROSS JOIN forecast_params p
# MAGIC   CROSS JOIN (SELECT explode(sequence(1, (SELECT horizon_weeks FROM forecast_params))) AS k)
# MAGIC ),
# MAGIC baseline AS (
# MAGIC   SELECT client_id, AVG(n_launches) AS mean_8w, MAX(n_launches) AS max_8w
# MAGIC   FROM (SELECT client_id, n_launches, ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY ds DESC) AS rn FROM launch_timeseries)
# MAGIC   WHERE rn <= 8 GROUP BY client_id
# MAGIC ),
# MAGIC combined AS (
# MAGIC   SELECT g.client_id, g.ds,
# MAGIC          COALESCE(f.n_launches_forecast, b.mean_8w, 0) AS fc,
# MAGIC          COALESCE(f.n_launches_lower, 0) AS lo,
# MAGIC          COALESCE(f.n_launches_upper, b.max_8w, 0) AS hi,
# MAGIC          COALESCE(s.n_launches, 0) AS scheduled
# MAGIC   FROM grid g
# MAGIC   LEFT JOIN forecasted_launches f ON f.client_id = g.client_id AND CAST(f.ds AS DATE) = g.ds
# MAGIC   LEFT JOIN baseline b ON b.client_id = g.client_id
# MAGIC   LEFT JOIN scheduled_launches s ON s.client_id = g.client_id AND s.ds = g.ds
# MAGIC )
# MAGIC SELECT client_id, ds,
# MAGIC        GREATEST(fc, scheduled) AS metric_forecast,
# MAGIC        GREATEST(hi, fc, scheduled) AS metric_upper,
# MAGIC        GREATEST(lo, scheduled) AS metric_lower
# MAGIC FROM combined;
# MAGIC
# MAGIC -- Each run replaces the previous forecast (columns unchanged, so the Lakebase synced table and the app keep working)
# MAGIC INSERT OVERWRITE ${catalog}.gold.launch_forecasts
# MAGIC SELECT client_id, ds, metric_forecast, metric_upper, metric_lower, current_timestamp() AS forecast_generated_at
# MAGIC FROM final_forecast;

# COMMAND ----------

# DBTITLE 1,Preview history, scheduled launches and forecast
# MAGIC %sql
# MAGIC -- History (to the cutoff), scheduled launches (announced, after the cutoff) and the forecast, for charting
# MAGIC SELECT CAST(ds AS DATE) AS ds, client_id, n_launches AS actual, CAST(NULL AS DOUBLE) AS scheduled, CAST(NULL AS DOUBLE) AS forecast
# MAGIC FROM launch_timeseries
# MAGIC UNION ALL
# MAGIC SELECT ds, client_id, NULL, CAST(n_launches AS DOUBLE), NULL FROM scheduled_launches
# MAGIC UNION ALL
# MAGIC SELECT ds, client_id, NULL, NULL, metric_forecast FROM final_forecast
# MAGIC ORDER BY client_id, ds;