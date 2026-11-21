# Changeover impact evidence

Captured 2026-11-21 18:08 UTC. Output of `src/analysis/changeover_impact` in `gold.changeover_impact`, compared with the planted effects in the synthetic answer key `silver.synthetic_changeover_truth`.

### Estimated vs planted effect per measured changeover

```sql
SELECT i.client_id, i.article_description, i.launch_date, ROUND(i.effect_pct, 1) AS estimated_pct,
       ROUND(i.ci_low, 1) AS ci_low, ROUND(i.ci_high, 1) AS ci_high, t.planted_effect_pct AS planted_pct,
       ROUND(i.effect_pct - t.planted_effect_pct, 1) AS error_pts,
       t.planted_effect_pct BETWEEN i.ci_low AND i.ci_high AS planted_inside_range, i.significant, i.controls_fit
FROM patricia_aws_serverless_catalog.gold.changeover_impact i JOIN patricia_aws_serverless_catalog.silver.synthetic_changeover_truth t ON t.gtin_old = i.gtin_old
WHERE i.status = 'measured' ORDER BY i.launch_date
```

| client_id | article_description | launch_date | estimated_pct | ci_low | ci_high | planted_pct | error_pts | planted_inside_range | significant | controls_fit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NIVEA | NIVEA Creme Dose 75ml | 2026-03-02 | 11.6 | 6.4 | 16.4 | 8.0 | 3.6 | True | True | False |
| NIVEA | NIVEA Sun Protect SPF30 200ml | 2026-04-13 | 15.2 | 9.9 | 20.2 | 15.0 | 0.2 | True | True | True |
| Henkel | Persil Color Gel 1.5L | 2026-05-04 | -8.5 | -12.7 | -4.5 | -6.0 | -2.5 | True | True | True |
| Henkel | Somat Classic Tabs 40pcs | 2026-06-01 | -3.2 | -7.6 | 1.0 | 0.0 | -3.2 | True | False | False |
| Unilever | Dove Original Deo Spray 150ml | 2026-07-06 | 11.1 | 5.9 | 15.9 | 12.0 | -0.9 | True | True | True |
| Unilever | Axe Apollo Shower Gel 250ml | 2026-08-03 | -10.3 | -14.4 | -6.4 | -10.0 | -0.3 | True | True | True |

### Summary

```sql
SELECT COUNT(*) AS measured, ROUND(AVG(ABS(i.effect_pct - t.planted_effect_pct)), 2) AS mean_abs_error_pts,
       SUM(CASE WHEN t.planted_effect_pct BETWEEN i.ci_low AND i.ci_high THEN 1 ELSE 0 END) AS planted_inside_95pct_range,
       (SELECT COUNT(*) FROM patricia_aws_serverless_catalog.gold.changeover_impact WHERE status = 'pending') AS pending
FROM patricia_aws_serverless_catalog.gold.changeover_impact i JOIN patricia_aws_serverless_catalog.silver.synthetic_changeover_truth t ON t.gtin_old = i.gtin_old WHERE i.status = 'measured'
```

| measured | mean_abs_error_pts | planted_inside_95pct_range | pending |
| --- | --- | --- | --- |
| 6 | 1.77 | 6 | 6 |

Reading the result: every planted effect lies inside its 95% range; the 0% planted effect (Somat) is correctly reported as not significant; the two estimates with the largest errors (Creme Dose 75ml, Somat) are the two flagged `controls_fit = False`.
