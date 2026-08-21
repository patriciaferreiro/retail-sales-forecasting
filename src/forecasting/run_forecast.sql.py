# Databricks notebook source
# DBTITLE 1,Prepare time series from product launches
# MAGIC %sql
# MAGIC -- Aggregate product launches into a time series suitable for forecasting
# MAGIC -- Groups by client and counts launches per week
# MAGIC CREATE OR REPLACE TEMPORARY VIEW launch_timeseries AS
# MAGIC SELECT
# MAGIC   client_id,
# MAGIC   DATE_TRUNC('week', launch_date) AS ds,
# MAGIC   COUNT(*) AS n_launches,
# MAGIC   COUNT(DISTINCT category) AS n_categories
# MAGIC FROM ${catalog}.silver.product_launches
# MAGIC WHERE launch_date IS NOT NULL
# MAGIC GROUP BY client_id, DATE_TRUNC('week', launch_date)
# MAGIC ORDER BY client_id, ds;

# COMMAND ----------

# DBTITLE 1,Run ai_forecast per client
# MAGIC %sql
# MAGIC -- Generate 12-week forecast of launch volume per client
# MAGIC -- ai_forecast automatically handles seasonality and trends
# MAGIC CREATE OR REPLACE TEMPORARY VIEW forecasted_launches AS
# MAGIC SELECT * FROM ai_forecast(
# MAGIC   TABLE(launch_timeseries),
# MAGIC   horizon => (SELECT MAX(ds) + INTERVAL 12 WEEKS FROM launch_timeseries),
# MAGIC   time_col => 'ds',
# MAGIC   value_col => ARRAY('n_launches', 'n_categories'),
# MAGIC   group_col => 'client_id',
# MAGIC   prediction_interval_width => 0.90,
# MAGIC   frequency => 'W',
# MAGIC   parameters => '{"global_floor": 0}'
# MAGIC );

# COMMAND ----------

# DBTITLE 1,Write forecast results to gold table
# MAGIC %sql
# MAGIC -- Persist forecast to gold layer for sharing
# MAGIC INSERT INTO ${catalog}.gold.launch_forecasts
# MAGIC SELECT
# MAGIC   client_id,
# MAGIC   ds,
# MAGIC   n_launches_forecast AS metric_forecast,
# MAGIC   n_launches_upper AS metric_upper,
# MAGIC   n_launches_lower AS metric_lower,
# MAGIC   current_timestamp() AS forecast_generated_at
# MAGIC FROM forecasted_launches;

# COMMAND ----------

# DBTITLE 1,Preview forecast with actuals for visualization
# MAGIC %sql
# MAGIC -- Combined view: actuals + forecast (for dashboard charting)
# MAGIC -- Bridge row ensures continuous line between series
# MAGIC SELECT ds, client_id, n_launches AS actual, CAST(NULL AS DOUBLE) AS forecast
# MAGIC FROM launch_timeseries
# MAGIC UNION ALL
# MAGIC -- Bridge row
# MAGIC SELECT ds, client_id, CAST(NULL AS DOUBLE), n_launches
# MAGIC FROM launch_timeseries
# MAGIC WHERE (client_id, ds) IN (
# MAGIC   SELECT client_id, MAX(ds) FROM launch_timeseries GROUP BY client_id
# MAGIC )
# MAGIC UNION ALL
# MAGIC SELECT ds, client_id, CAST(NULL AS DOUBLE), n_launches_forecast
# MAGIC FROM forecasted_launches
# MAGIC ORDER BY client_id, ds;