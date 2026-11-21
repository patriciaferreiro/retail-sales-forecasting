# Data checks

Captured 2026-11-21 18:08 UTC by running these queries on serverless compute against `patricia_aws_serverless_catalog`. Outputs are pasted verbatim.

### Row counts of the main tables and views

```sql
SELECT 'silver.product_launches' AS object, COUNT(*) AS rows FROM patricia_aws_serverless_catalog.silver.product_launches
UNION ALL SELECT 'silver.weekly_sales', COUNT(*) FROM patricia_aws_serverless_catalog.silver.weekly_sales
UNION ALL SELECT 'gold.product_weekly_sales', COUNT(*) FROM patricia_aws_serverless_catalog.gold.product_weekly_sales
UNION ALL SELECT 'gold.sales_forecast', COUNT(*) FROM patricia_aws_serverless_catalog.gold.sales_forecast
UNION ALL SELECT 'gold.sales_forecast_accuracy', COUNT(*) FROM patricia_aws_serverless_catalog.gold.sales_forecast_accuracy
UNION ALL SELECT 'gold.changeover_impact', COUNT(*) FROM patricia_aws_serverless_catalog.gold.changeover_impact
UNION ALL SELECT 'gold.changeover_weekly', COUNT(*) FROM patricia_aws_serverless_catalog.gold.changeover_weekly
UNION ALL SELECT 'gold.launch_forecasts', COUNT(*) FROM patricia_aws_serverless_catalog.gold.launch_forecasts
```

| object | rows |
| --- | --- |
| gold.product_weekly_sales | 4784 |
| gold.sales_forecast | 1104 |
| silver.product_launches | 1149 |
| silver.weekly_sales | 19208 |
| gold.sales_forecast_accuracy | 2 |
| gold.changeover_impact | 12 |
| gold.changeover_weekly | 402 |
| gold.launch_forecasts | 36 |

### Real vs synthetic rows in silver.product_launches

```sql
SELECT CASE WHEN source_file LIKE 'synthetic://seed/changeovers/%' THEN 'synthetic past changeovers'
            WHEN source_file LIKE 'synthetic://%' THEN 'synthetic launch history'
            ELSE 'extracted from real documents' END AS origin,
       client_id, COUNT(*) AS rows
FROM patricia_aws_serverless_catalog.silver.product_launches GROUP BY 1, 2 ORDER BY 1, 2
```

| origin | client_id | rows |
| --- | --- | --- |
| extracted from real documents | Henkel | 3 |
| extracted from real documents | NIVEA | 3 |
| synthetic launch history | Henkel | 253 |
| synthetic launch history | NIVEA | 334 |
| synthetic launch history | Unilever | 550 |
| synthetic past changeovers | Henkel | 2 |
| synthetic past changeovers | NIVEA | 2 |
| synthetic past changeovers | Unilever | 2 |

### Stitching old + new GTIN loses or duplicates nothing

```sql
SELECT (SELECT SUM(units) FROM patricia_aws_serverless_catalog.silver.weekly_sales) AS units_raw,
       (SELECT SUM(units) FROM patricia_aws_serverless_catalog.gold.product_weekly_sales) AS units_stitched,
       (SELECT COUNT(*) - COUNT(DISTINCT product_key, week) FROM patricia_aws_serverless_catalog.gold.product_weekly_sales) AS duplicate_product_weeks,
       (SELECT COUNT(DISTINCT product_key) FROM patricia_aws_serverless_catalog.gold.product_weekly_sales) AS products,
       (SELECT COUNT(DISTINCT week) FROM patricia_aws_serverless_catalog.gold.product_weekly_sales) AS weeks
```

| units_raw | units_stitched | duplicate_product_weeks | products | weeks |
| --- | --- | --- | --- | --- |
| 1929350 | 1929350 | 0 | 46 | 104 |

Expected: units_raw = units_stitched, 0 duplicates.

### Forecast completeness and validity per model

```sql
SELECT model, COUNT(*) AS rows, COUNT(DISTINCT product_key) AS products, MIN(week) AS first_week, MAX(week) AS last_week,
       SUM(CASE WHEN forecast_units IS NULL THEN 1 ELSE 0 END) AS null_forecasts,
       SUM(CASE WHEN NOT (lower_units <= forecast_units AND forecast_units <= upper_units AND lower_units >= 0) THEN 1 ELSE 0 END) AS invalid_ranges
FROM patricia_aws_serverless_catalog.gold.sales_forecast GROUP BY model ORDER BY model
```

| model | rows | products | first_week | last_week | null_forecasts | invalid_ranges |
| --- | --- | --- | --- | --- | --- | --- |
| ai_forecast | 552 | 46 | 2026-11-16 | 2027-02-01 | 0 | 0 |
| mlflow_lightgbm | 552 | 46 | 2026-11-16 | 2027-02-01 | 0 | 0 |

Expected: 46 products x 12 weeks = 552 rows per model, 0 NULLs, 0 invalid ranges.
