# Product Launch Forecast App: Specification

Status: implemented (v2). Owner: patricia.ferreiro@databricks.com

## Goal

A Databricks App for subject-matter experts (category and key-account managers) that lets them:

1. Upload new product launch / GTIN changeover documents (PDF, DOCX, images)
2. Review and validate the AI-extracted product details, with AI fix suggestions
3. Publish approved products to silver
4. See the weekly unit sales forecast per product from two models (ai_forecast and an MLflow LightGBM model)
5. See how sales changed after each GTIN changeover
6. Ask questions about all of it in plain language with Genie

The app must support fast edits and many users working at the same time. Sales data is synthetic demo data.

## Tabs

| Tab | What it shows |
| --- | --- |
| Upload & review | Collapsible Documents panel (upload, vendor filter, past uploads), editable review grid with validation, product detail panel with AI fix suggestions, publish |
| Ingestion check | Document preview next to the extracted fields, to spot extraction errors |
| Forecast | Vendor and product pickers; actual weekly units plus both models' 12-week forecast with 90% ranges; 12-week total vs the same weeks last year; holdout accuracy per model; **Genie insights** below the chart |
| Changeover impact | Measured and pending changeovers; effect on weekly units with 95% range, transition dip, revenue effect, controls-fit warning; actual vs expected chart; **Genie insights** below the chart |
| Architecture (header button) | Data flow and the Databricks components of the running deployment, read from its configuration |

### Genie insights

A section below the chart on the Forecast and Changeover impact pages:

* **Genie's analysis** of the selected product or changeover (answer, result table, SQL), written automatically
* **What you can ask Genie**: question chips in four groups (Compare, Rank, Explain, Drill down) filled with the selected product, vendor and category, plus Genie's suggested next questions
* A question box with an inline conversation thread (follow-ups stay in the same Genie conversation)

Analyses are cached in Lakebase (`genie_insights`) with the data version they were made from (latest `generated_at` in `gold.sales_forecast`, or `evaluated_at` in `gold.changeover_impact`). One background worker prepares all products and changeovers at app startup and after each successful forecast run, one question at a time with exponential backoff on Genie rate limits; a missing or stale analysis is generated when someone opens the item (the page polls every 3 seconds).

## Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Frontend | React + Recharts | Upload, review grid, charts, Genie insights |
| Backend | FastAPI | API, validation, orchestration, Genie calls |
| Operational store | Lakebase Postgres | Review queue, edits, audit log, AI suggestions, forecast runs, cached Genie insights |
| Analytical store | Delta (Unity Catalog) | `silver.product_launches`, `silver.weekly_sales`, `gold.sales_forecast`, `gold.changeover_impact`, ... |
| Compute | SQL warehouse | `ai_parse_document`, `ai_extract`, MERGE into silver, reads of gold |
| AI | Model Serving (`databricks-claude-sonnet-4-6`), Genie space | AI fix suggestions; natural-language questions and insights |
| Orchestration | Lakeflow Job `product_launch_forecast_job` | Sales forecast tasks started from the app |
| Deployment | Declarative Automation Bundle (this repo) | App defined as a bundle resource next to the job |

## User flow

1. **Upload**: user drops one or more files. The backend writes each file to
   `/Volumes/<catalog>/bronze/raw_documents/uploads/<upload_id>/<file_name>` through the Files API.
2. **Extract**: the backend runs the same `ai_parse_document` and `ai_extract` logic as
   `src/extraction/extract_product_data` on that single file through the SQL warehouse.
   The extracted products land in Lakebase as `pending` review rows. Nothing is written to silver yet.
3. **Validate**: an editable grid shows the products of the upload. Automatic checks flag rows:
   * `launch_date` missing, unparseable, or in the past
   * `identifier_new` / `identifier_old` with invalid length or check digit (GTIN-8/12/13/14, EAN)
   * missing `client_id` or `article_description`
   * duplicate of an existing silver product (same client, identifier_new)
   Users edit cells inline, then approve or reject rows.
4. **Publish**: approved rows are merged into `silver.product_launches` on the business key
   (`client_id`, `identifier_new`, `article_description`), so reruns never create duplicates.
5. **Forecast**: **Run forecast** starts the job's `run_sales_forecast` and `sales_forecast_mlflow` tasks.
   The UI polls the run status and, on success, reloads the per-product sales forecast; the app then
   regenerates the Genie insights in the background.
6. **Changeover impact**: results of `src/analysis/changeover_impact` (run by hand) per changeover.
7. **Ask**: Genie insights and follow-up questions on both pages.

## Lakebase data model

```
uploads(
  upload_id UUID PK, file_name TEXT, volume_path TEXT,
  status TEXT  -- uploaded | extracting | extracted | failed
  error TEXT, uploaded_by TEXT, uploaded_at TIMESTAMPTZ
)

review_products(
  product_id UUID PK, upload_id UUID FK -> uploads,
  client_id TEXT, launch_date DATE, article_description TEXT,
  identifier_old TEXT, identifier_new TEXT, identifier_type TEXT,
  size TEXT, packaging TEXT, category TEXT, notes TEXT,
  validation_errors JSONB,
  status TEXT  -- pending | approved | rejected | published
  version INT NOT NULL DEFAULT 1,   -- optimistic concurrency
  updated_by TEXT, updated_at TIMESTAMPTZ
)

review_audit(
  audit_id BIGSERIAL PK, product_id UUID, field TEXT,
  old_value TEXT, new_value TEXT, changed_by TEXT, changed_at TIMESTAMPTZ
)

forecast_runs(
  run_id BIGINT PK, triggered_by TEXT, status TEXT, state_message TEXT, run_page_url TEXT,
  started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ
)

ai_suggestions(
  suggestion_id UUID PK, product_id UUID FK -> review_products, field TEXT,
  action TEXT, current_value TEXT, suggested_value TEXT, confidence TEXT, reason TEXT,
  evidence_quote TEXT, evidence_found BOOLEAN, value_in_document BOOLEAN, still_invalid BOOLEAN,
  status TEXT  -- suggested | applied | dismissed | superseded
  created_by TEXT, decided_by TEXT, ...
)

genie_insights(
  scope TEXT, item_key TEXT,         -- PK (product | changeover, product_key / gtin_old)
  data_version TEXT, question TEXT,
  status TEXT  -- generating | ready | failed
  text TEXT, sql TEXT, columns JSONB, rows JSONB, suggested JSONB,
  conversation_id TEXT, error TEXT, updated_at TIMESTAMPTZ
)
```

`uploads` also stores the parsed document text. The app creates all tables at startup, so they are owned by the
app service principal. A synced table keeps a read-only copy of `gold.launch_forecasts` (launch counts) in Lakebase.

## Concurrency

* Every edit sends the row `version` it was based on. The backend runs
  `UPDATE ... SET ..., version = version + 1 WHERE product_id = :id AND version = :version`.
  Zero rows updated means someone else changed it first; the API returns 409 and the UI reloads the row.
* Approving or publishing uses the same version check.
* Only one forecast run at a time: the backend checks `forecast_runs` for an active run before starting a new one.

## API (FastAPI)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/uploads` | Upload file(s), start extraction |
| GET | `/api/uploads` | List uploads with status and vendors |
| POST | `/api/uploads/{id}/retry` | Retry a failed extraction |
| GET | `/api/uploads/{id}/products` | Products of an upload with validation errors |
| GET | `/api/uploads/{id}/file`, `/text`, `/fields` | Original document, parsed text, extracted vs current fields |
| GET | `/api/products/{id}/detail`, `/audit` | Product detail (with document evidence), edit history |
| PATCH | `/api/products/{id}` | Edit fields (requires `version`) |
| POST | `/api/products/status` | Approve, reject or reset a list of products |
| POST | `/api/products/{id}/suggest` | AI fix suggestions for a product's errors |
| GET | `/api/products/{id}/suggestions` | Suggestions of a product |
| POST | `/api/suggestions/{id}/apply`, `/dismiss` | Apply or dismiss a suggestion |
| POST | `/api/publish` | MERGE approved products into silver (optional `product_ids`) |
| POST | `/api/forecast/run` | Start the sales forecast tasks |
| GET | `/api/forecast/runs`, `/api/forecast/runs/{run_id}` | Run history and status |
| GET | `/api/forecast?client_id=` | Launch-count forecast (both models; kept for the API, not shown in the UI) |
| GET | `/api/sales-forecast/products` | Products with a sales forecast, plus holdout accuracy per model |
| GET | `/api/sales-forecast/{product_key}` | Actual weekly units and both models' forecast for a product |
| GET | `/api/changeovers?client_id=` | Changeover impact per changeover |
| GET | `/api/changeovers/{gtin_old}/weekly` | Actual vs expected weekly units around a changeover |
| POST | `/api/genie/ask` | Ask Genie a question or follow-up (text, SQL, rows, suggested questions) |
| GET | `/api/genie/insight?scope=&key=` | Cached Genie analysis; queues (re)generation when missing or stale |
| POST | `/api/genie/insight/refresh` | Regenerate one analysis |
| POST | `/api/genie/insights/prewarm` | Queue all missing or stale analyses |
| GET | `/api/architecture`, `/api/me`, `/api/health` | Live components, current user, health |

## Permissions (app service principal)

App resources (from `resources/app.yml`):

* Lakebase database: CAN CONNECT AND CREATE
* SQL warehouse: CAN USE
* Job `product_launch_forecast_job`: CAN MANAGE RUN
* Serving endpoint `databricks-claude-sonnet-4-6`: CAN QUERY
* Volume `bronze.raw_documents`: WRITE VOLUME
* Genie space `genie_space_id`: CAN RUN (`GENIE_SPACE_ID`)

Unity Catalog grants (applied by hand, not by the bundle):

* USE CATALOG, USE SCHEMA on bronze, silver, gold
* READ VOLUME, WRITE VOLUME on `bronze.raw_documents`
* SELECT and MODIFY on `silver.product_launches`
* SELECT on `gold.launch_forecasts`, `gold.launch_forecasts_mlflow`, `gold.launch_forecast_accuracy`
* SELECT on `gold.sales_forecast`, `gold.product_weekly_sales`, `gold.sales_forecast_accuracy`
* SELECT on `gold.changeover_impact`, `gold.changeover_weekly`

Genie runs queries as the app service principal, so it can only read what these grants allow.
User identity is taken from the app request headers and stored in `uploaded_by` / `updated_by` and in logs of Genie questions.

## Resolved pipeline issues

* Silver schema regression (MAP vs flat columns): fixed, silver is flat
* Extraction idempotency: MERGE on `document_id`, one parse per file
* Gold forecasts replace the previous run instead of appending

## Out of scope

* Email ingestion (existing volume drop path stays)
* Per-client row-level access control
* Genie answering on behalf of the end user (it runs as the app service principal)
* Scheduled runs of `changeover_impact` (run by hand for now)
