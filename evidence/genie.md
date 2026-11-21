# Genie evidence

Captured 2026-11-21 18:08 UTC.

## Genie space

`Product Sales & Changeover Analyst` (id `01f1e5a99d2d1c66aef6ac589e154cd7`), SQL warehouse `4471bd9074d14824`, read with `GET /api/2.0/genie/spaces/{id}`.

| Configured | Count |
| --- | --- |
| Tables | 6 |
| Table descriptions | 6 |
| Sample questions | 5 |
| Text instructions | 1 |
| Example SQL answers | 2 |

Tables: `gold.changeover_impact`, `gold.changeover_weekly`, `gold.product_weekly_sales`, `gold.sales_forecast`, `gold.sales_forecast_accuracy`, `silver.product_launches`

These counts were read before the fix in question 2. After the fix the space has the same tables and instruction (with one added paragraph) and **3** example SQL answers.

## Live questions

Asked through the Genie Conversation API (`start_conversation_and_wait`) as the developer, then checked against a direct query.

### 1. Top products: correct

**Question:** Which 3 products are forecast to sell the most units in the next 12 weeks?

Status `COMPLETED`, answered in 17 s, conversation `01f1e5d70c911d87949f4123509637d4`.

**Genie's answer (verbatim)**

> Using the **mlflow_lightgbm** forecast model, the **3 products** forecast to sell the most units over the next 12 weeks are:
> - **NIVEA Soft Jar 200ml** (**NIVEA**) — **8,618** units
> - **Persil Powder 1.3kg** (**Henkel**) — **8,366** units
> - **NIVEA Creme Dose 75ml** (**NIVEA**) — **8,208** units
>
> The spread between first and third place is **410 units**, so the top 3 are forecast to be fairly close in volume.

**SQL Genie generated and ran**

```sql
SELECT
  `client_id`,
  `article_description`,
  ROUND(SUM(`forecast_units`)) AS `forecast_units_12w`
FROM `patricia_aws_serverless_catalog`.`gold`.`sales_forecast`
WHERE `model` = 'mlflow_lightgbm'
  AND `client_id` IS NOT NULL
  AND `article_description` IS NOT NULL
GROUP BY `client_id`, `article_description`
ORDER BY `forecast_units_12w` DESC
LIMIT 3
```

**Result rows**

| client_id | article_description | forecast_units_12w |
| --- | --- | --- |
| NIVEA | NIVEA Soft Jar 200ml | 8618.0 |
| Henkel | Persil Powder 1.3kg | 8366.0 |
| NIVEA | NIVEA Creme Dose 75ml | 8208.0 |

**Cross-check with a direct query:** same three products and the same units.

```sql
SELECT client_id, article_description, ROUND(SUM(forecast_units)) AS forecast_units_12w
FROM patricia_aws_serverless_catalog.gold.sales_forecast WHERE model = 'mlflow_lightgbm'
GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 3
```

| client_id | article_description | forecast_units_12w |
| --- | --- | --- |
| NIVEA | NIVEA Soft Jar 200ml | 8618.0 |
| Henkel | Persil Powder 1.3kg | 8366.0 |
| NIVEA | NIVEA Creme Dose 75ml | 8208.0 |

### 2. Model accuracy: WRONG answer (before the fix)

**Question:** Which forecast model is more accurate, and by how much?

Status `COMPLETED`, answered in 18 s, conversation `01f1e5d7170b185fb8f842c662ea37a8`.

**Genie's answer (verbatim)**

> The latest evaluation does **not** show which model is more accurate, because the result only includes **mlflow_lightgbm** with WAPE **7.2%** for the holdout period **2026-08-24 to 2026-11-09**, while **ai_forecast** accuracy values are missing. Based on the visible data, the measurable result is **mlflow_lightgbm = 7.2% WAPE**, with **30** MAE units, **83.2%** coverage, and **-0.7%** bias.

**SQL Genie generated and ran**

```sql
WITH latest AS (
  SELECT MAX(`evaluated_at`) AS `max_evaluated_at`
  FROM `patricia_aws_serverless_catalog`.`gold`.`sales_forecast_accuracy`
  WHERE `evaluated_at` IS NOT NULL
), ranked AS (
  SELECT
    `model`,
    `holdout_start`,
    `holdout_end`,
    `wape_pct`,
    `mae_units`,
    `coverage_pct`,
    `bias_pct`,
    `evaluated_at`
  FROM `patricia_aws_serverless_catalog`.`gold`.`sales_forecast_accuracy`
  WHERE `model` IS NOT NULL
    AND `wape_pct` IS NOT NULL
    AND `evaluated_at` = (SELECT `max_evaluated_at` FROM latest)
), comparison AS (
  SELECT
    MAX(CASE WHEN `model` = 'mlflow_lightgbm' THEN `wape_pct` END) AS `mlflow_lightgbm_wape_pct`,
    MAX(CASE WHEN `model` = 'ai_forecast' THEN `wape_pct` END) AS `ai_forecast_wape_pct`,
    MAX(CASE WHEN `model` = 'mlflow_lightgbm' THEN `mae_units` END) AS `mlflow_lightgbm_mae_units`,
    MAX(CASE WHEN `model` = 'ai_forecast' THEN `mae_units` END) AS `ai_forecast_mae_units`,
    MAX(CASE WHEN `model` = 'mlflow_lightgbm' THEN `coverage_pct` END) AS `mlflow_lightgbm_coverage_pct`,
    MAX(CASE WHEN `model` = 'ai_forecast' THEN `coverage_pct` END) AS `ai_forecast_coverage_pct`,
    MAX(CASE WHEN `model` = 'mlflow_lightgbm' THEN `bias_pct` END) AS `mlflow_lightgbm_bias_pct`,
    MAX(CASE WHEN `model` = 'ai_forecast' THEN `bias_pct` END) AS `ai_forecast_bias_pct`,
    MAX(`holdout_start`) AS `holdout_start`,
    MAX(`holdout_end`) AS `holdout_end`,
    MAX(`evaluated_at`) AS `evaluated_at`
  FROM ranked
)
SELECT
  CASE
    WHEN `mlflow_lightgbm_wape_pct` < `ai_forecast_wape_pct` THEN 'mlflow_lightgbm'
    WHEN `ai_forecast_wape_pct` < `mlflow_lightgbm_wape_pct` THEN 'ai_forecast'
    ELSE 'tie'
  END AS `more_accurate_model`,
  ROUND(ABS(`mlflow_lightgbm_wape_pct` - `ai_forecast_wape_pct`), 1) AS `wape_gap_pct_points`,
  ROUND(`mlflow_lightgbm_wape_pct`, 1) AS `mlflow_lightgbm_wape_pct`,
  ROUND(`ai_forecast_wape_pct`, 1) AS `ai_forecast_wape_pct`,
  ROUND(`mlflow_lightgbm_mae_units`, 0) AS `mlflow_lightgbm_mae_units`,
  ROUND(`ai_forecast_mae_units`, 0) AS `ai_forecast_mae_units`,
  ROUND(`mlflow_lightgbm_coverage_pct`, 1) AS `mlflow_lightgbm_coverage_pct`,
  ROUND(`ai_forecast_coverage_pct`, 1) AS `ai_forecast_coverage_pct`,
  ROUND(`mlflow_lightgbm_bias_pct`, 1) AS `mlflow_lightgbm_bias_pct`,
  ROUND(`ai_forecast_bias_pct`, 1) AS `ai_forecast_bias_pct`,
  `holdout_start`,
  `holdout_end`,
  `evaluated_at`
FROM comparison
```

**Result rows**

| more_accurate_model | wape_gap_pct_points | mlflow_lightgbm_wape_pct | ai_forecast_wape_pct | mlflow_lightgbm_mae_units | ai_forecast_mae_units | mlflow_lightgbm_coverage_pct | ai_forecast_coverage_pct | mlflow_lightgbm_bias_pct | ai_forecast_bias_pct | holdout_start | holdout_end | evaluated_at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tie |  | 7.2 |  | 30.0 |  | 83.2 |  | -0.7 |  | 2026-08-24 | 2026-11-09 | 2026-11-21T12:46:02.710Z |

**Why it was wrong:** the table holds one row per model, but the two models are scored by separate job tasks about a minute apart (`ai_forecast` at 2026-11-21 12:44:58, `mlflow_lightgbm` at 12:46:02). Genie kept only rows at `MAX(evaluated_at)`, so the `ai_forecast` row was filtered out and the comparison fell through to "tie". The data was correct; the query was not.

**Fix (applied to the Genie space):** an instruction that the table has one row per model with different `evaluated_at` values, so model comparisons must use every row and never filter to `MAX(evaluated_at)`; plus an example SQL for this question.

### 3. Model accuracy: same question after the fix, correct

**Question:** Which forecast model is more accurate, and by how much?

Status `COMPLETED`, answered in 13 s, conversation `01f1e5d7d5ee1df189cc90d5aceaedfb`.

**Genie's answer (verbatim)**

> **mlflow_lightgbm** is more accurate than **ai_forecast**. Its error rate is **7.2%** versus **26.9%**, so it is better by **19.7 percentage points**; it also has much lower average unit error (**29.8** vs **111.4**) over the same holdout period.

**SQL Genie generated and ran**

```sql
SELECT `model`, ROUND(`wape_pct`, 1) AS `wape_pct`, ROUND(`mae_units`, 1) AS `mae_units`, ROUND(`coverage_pct`, 1) AS `coverage_pct`, ROUND(`bias_pct`, 1) AS `bias_pct`, `holdout_start`, `holdout_end`
FROM `patricia_aws_serverless_catalog`.`gold`.`sales_forecast_accuracy`
ORDER BY `wape_pct`
```

**Result rows**

| model | wape_pct | mae_units | coverage_pct | bias_pct | holdout_start | holdout_end |
| --- | --- | --- | --- | --- | --- | --- |
| mlflow_lightgbm | 7.2 | 29.8 | 83.2 | -0.7 | 2026-08-24 | 2026-11-09 |
| ai_forecast | 26.9 | 111.4 | 65.0 | 11.5 | 2026-08-24 | 2026-11-09 |

### 4. Model accuracy: reworded question after the fix, correct

**Question:** Compare the holdout error and bias of ai_forecast and the MLflow model

Status `COMPLETED`, answered in 13 s, conversation `01f1e5d7fa1e1b9cb7fabb4b8ab2c530`.

**Genie's answer (verbatim)**

> For the holdout period **2026-08-24 to 2026-11-09**, **mlflow_lightgbm** performed better than **ai_forecast** on both error and bias. Its holdout error was **7.2% WAPE** versus **26.9%** for **ai_forecast**, and its bias was **-0.7%** versus **11.5%**, meaning the MLflow model was much closer to actual sales and far less skewed overall.

**SQL Genie generated and ran**

```sql
SELECT
  `model`,
  `holdout_start`,
  `holdout_end`,
  `wape_pct`,
  `mae_units`,
  `bias_pct`
FROM `patricia_aws_serverless_catalog`.`gold`.`sales_forecast_accuracy`
WHERE `model` IN ('ai_forecast', 'mlflow_lightgbm')
  AND `model` IS NOT NULL
  AND `wape_pct` IS NOT NULL
  AND `bias_pct` IS NOT NULL
ORDER BY `wape_pct` ASC
```

**Result rows**

| model | holdout_start | holdout_end | wape_pct | mae_units | bias_pct |
| --- | --- | --- | --- | --- | --- |
| mlflow_lightgbm | 2026-08-24 | 2026-11-09 | 7.189686589293019 | 29.789919341364698 | -0.7435578259304948 |
| ai_forecast | 2026-08-24 | 2026-11-09 | 26.877193858285104 | 111.36360774792381 | 11.545454942458813 |

This wording is not in the example SQL, so the correct answer comes from the new instruction, not from copying the example.

**Ground truth** (`SELECT model, wape_pct, bias_pct FROM gold.sales_forecast_accuracy`): mlflow_lightgbm 7.19% WAPE, -0.74% bias; ai_forecast 26.88% WAPE, +11.55% bias.
