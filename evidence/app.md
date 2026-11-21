# App evidence

Captured 2026-11-21 18:08 UTC.

## Deployment (`GET /api/2.0/apps/product-launch-forecast`)

| Field | Value |
| --- | --- |
| App | `product-launch-forecast` |
| URL | https://product-launch-forecast-7474647099307852.aws.databricksapps.com |
| App state | `RUNNING` |
| Compute state | `ACTIVE` |
| Active deployment | `01f1e5ba8d58119bae2fb14a1366b97f` |
| Deployment status | `SUCCEEDED`: App started successfully |
| Deployed at | 2026-11-21T14:48:02Z |
| Service principal | `app-2iapwf product-launch-forecast` |

## App resources

| Name | Type | Target | Permission |
| --- | --- | --- | --- |
| `sql-warehouse` | sql_warehouse | `4471bd9074d14824` | CAN_USE |
| `forecast-job` | job | `431565808481005` | CAN_MANAGE_RUN |
| `postgres` | postgres | `projects/product-launch-forecast/branches/production` | CAN_CONNECT_AND_CREATE |
| `llm` | serving_endpoint | `databricks-claude-sonnet-4-6` | CAN_QUERY |
| `raw-documents` | uc_securable | `patricia_aws_serverless_catalog.bronze.raw_documents` | WRITE_VOLUME |
| `genie-space` | genie_space | `Product Sales & Changeover Analyst` | CAN_RUN |

## API checks

Run with FastAPI's TestClient against the app's backend code (the same code as the deployed version), as the developer.

| Request | HTTP status | Result |
| --- | --- | --- |
| `GET /api/health` | 200 | {"status": "ok", "warehouse": true, "job": true} |
| `GET /api/uploads` | 200 | 3 uploads |
| `GET /api/sales-forecast/products` | 200 | 46 products; holdout WAPE ai_forecast 26.9%, mlflow_lightgbm 7.2% |
| `GET /api/sales-forecast/8710400100058` | 200 | 59 actual weeks; ai_forecast: 12 forecast weeks, mlflow_lightgbm: 12 forecast weeks |
| `GET /api/changeovers` | 200 | 12 changeovers (6 measured), error=None |
| `GET /api/changeovers/8710400100065/weekly` | 200 | 41 weeks of actual vs expected |
| `GET /api/genie/insight?scope=product&key=8710400100058` | 200 | status=ready, current=True |
| `GET /api/sales-forecast/abc` | 400 | {"detail":"product_key must be a numeric GTIN"} |

The last request is a deliberate bad input; 400 is the expected answer.

## Genie insights cache (Lakebase `review.genie_insights`, written by the app service principal)

| scope | status | n |
| --- | --- | --- |
| changeover | ready | 12 |
| product | ready | 46 |

### Example cached insight: Axe Apollo Shower Gel 250ml changeover

Written 2026-11-21 13:35:19.368066+00:00 by the app's background worker.

**Question the app asked Genie**

> Summarise the GTIN changeover of Axe Apollo Shower Gel 250ml (Unilever, Body care), gtin_old 8710400100065, switch week 2026-08-03: its effect_pct on weekly unit sales with the 95% range (ci_low to ci_high), whether it is significant and whether controls_fit is true, and how its effect ranks among all measured changeovers in gold.changeover_impact. Answer in at most 4 short sentences and return one summary row.

**Genie's answer**

> For **Unilever** product **Axe Apollo Shower Gel 250ml** in **Body care** with **gtin_old 8710400100065** and switch week **2026-08-03**, the estimated effect on weekly unit sales is **-10.3%**, with a **95% range from -14.4% to -6.4%**. The result is **significant = true** and **controls_fit = true**. Among **6** measured changeovers in **gold.changeover_impact**, **Axe Apollo Shower Gel 250ml** ranks **6th** by effect size in descending order, making it the **lowest** effect in the visible ranking.

**SQL**

```sql
WITH measured AS (
  SELECT
    `client_id`,
    `article_description`,
    `category`,
    `gtin_old`,
    `launch_date`,
    `effect_pct`,
    `ci_low`,
    `ci_high`,
    `significant`,
    `controls_fit`,
    RANK() OVER (ORDER BY `effect_pct` DESC) AS `effect_rank_desc`,
    COUNT(*) OVER () AS `measured_changeovers`
  FROM `patricia_aws_serverless_catalog`.`gold`.`changeover_impact`
  WHERE `status` = 'measured'
    AND `effect_pct` IS NOT NULL
)
SELECT
  `client_id`,
  `article_description`,
  `category`,
  `gtin_old`,
  `launch_date`,
  ROUND(`effect_pct`, 1) AS `effect_pct`,
  ROUND(`ci_low`, 1) AS `ci_low`,
  ROUND(`ci_high`, 1) AS `ci_high`,
  `significant`,
  `controls_fit`,
  `effect_rank_desc`,
  `measured_changeovers`
FROM measured
WHERE `client_id` ILIKE '%Unilever%'
  AND `article_description` ILIKE '%Axe Apollo Shower Gel 250ml%'
  AND `category` ILIKE '%Body care%'
  AND `gtin_old` = '8710400100065'
  AND `launch_date` = DATE '2026-08-03'
```

**Result**

| client_id | article_description | category | gtin_old | launch_date | effect_pct | ci_low | ci_high | significant | controls_fit | effect_rank_desc | measured_changeovers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Unilever | Axe Apollo Shower Gel 250ml | Body care | 8710400100065 | 2026-08-03 | -10.3 | -14.4 | -6.4 | true | true | 6 | 6 |
