# Value model evidence

Captured 2026-11-21 18:08 UTC. **Illustrative estimates, not measured results.** `gold.value_model_levers` recalculates from `gold.value_model_assumptions`.

### Levers (EUR per year)

```sql
SELECT lever_order, lever, buyer_kpi, primary_audience, kpi_effect_base, low_eur, base_eur, high_eur
FROM patricia_aws_serverless_catalog.gold.value_model_levers ORDER BY lever_order
```

| lever_order | lever | buyer_kpi | primary_audience | kpi_effect_base | low_eur | base_eur | high_eur |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Less master-data effort | Master-data cycle time and team hours | Domain owner | 600 hours a year freed for the master-data team | 8,000 | 27,000 | 88,000 |
| 2 | Fewer costly data errors | Master-data error rate, on-shelf availability, lost sales | Domain owner | 84 wrong GTINs or dates a year stopped before the shelf | 5,000 | 201,600 | 2,016,000 |
| 3 | Lower safety stock | Forecast accuracy (WAPE), inventory and working capital | Executive sponsor | EUR 692,308 less safety stock (working capital freed once) | 23,077 | 173,077 | 692,308 |
| 4 | Better changeover decisions | Gross margin of changed products | Executive sponsor | 600 changeovers a year with a measured sales drop to act on | 12,500 | 288,000 | 2,520,000 |

### Total

```sql
SELECT SUM(low_eur) AS low_eur, SUM(base_eur) AS base_eur, SUM(high_eur) AS high_eur FROM patricia_aws_serverless_catalog.gold.value_model_levers
```

| low_eur | base_eur | high_eur |
| --- | --- | --- |
| 48,577 | 689,677 | 5,316,308 |

### Assumptions

```sql
SELECT assumption_key, unit, low, base, high, used_by FROM patricia_aws_serverless_catalog.gold.value_model_assumptions ORDER BY used_by, assumption_key
```

| assumption_key | unit | low | base | high | used_by |
| --- | --- | --- | --- | --- | --- |
| changeovers_per_year | count | 2000 | 4000 | 8000 | all levers |
| annual_sales_per_product | EUR per year | 100000 | 200000 | 300000 | changeover_decisions |
| avg_drop | share | 0.05 | 0.08 | 0.1 | changeover_decisions |
| recovered_by_acting | share | 0.05 | 0.1 | 0.15 | changeover_decisions |
| share_negative_changeovers | share | 0.1 | 0.15 | 0.2 | changeover_decisions |
| errors_prevented | share | 0.5 | 0.7 | 0.8 | data_errors |
| manual_error_rate | share | 0.01 | 0.03 | 0.05 | data_errors |
| weekly_sales_per_product | EUR | 2000 | 4000 | 6000 | data_errors |
| weeks_lost_per_error | weeks | 1 | 2 | 3 | data_errors |
| gross_margin | share | 0.25 | 0.3 | 0.35 | data_errors, changeover_decisions |
| loaded_cost_per_hour | EUR per hour | 40 | 45 | 55 | master_data_effort |
| minutes_saved_per_product | minutes | 6 | 9 | 12 | master_data_effort |
| carrying_cost | share of inventory value | 0.2 | 0.25 | 0.3 | safety_stock |
| forecast_error_cut | share | 0.2 | 0.4 | 0.5 | safety_stock |
| safety_stock_weeks | weeks | 1 | 1.5 | 2 | safety_stock |
| sales_in_scope | EUR per year | 30,000,000 | 60,000,000 | 120,000,000 | safety_stock |
