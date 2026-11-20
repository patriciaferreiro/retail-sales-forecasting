# Product Launch Forecast App: Specification

Status: draft. Owner: patricia.ferreiro@databricks.com

## Goal

A Databricks App that lets business users:

1. Upload new product launch documents (PDF, DOCX, images)
2. Review and validate the AI-extracted product details
3. Publish approved products and run the 12-week launch forecast
4. View actuals and forecasts per client

The app must support fast edits and many users working at the same time.

## Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Frontend | React | Upload, review grid, job status, charts |
| Backend | FastAPI | API, validation, orchestration |
| Operational store | Lakebase Postgres | Review queue, edits, audit log, fast reads |
| Analytical store | Delta (Unity Catalog) | `silver.product_launches`, `gold.launch_forecasts` |
| Compute | SQL warehouse | `ai_parse_document`, `ai_extract`, MERGE into silver |
| Orchestration | Lakeflow Job `product_launch_forecast_job` | Forecast run |
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
5. **Forecast**: a button starts the job (forecast task only). The UI polls the run status and,
   on success, shows actuals plus forecast with confidence bands per client.

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
  run_id BIGINT PK, triggered_by TEXT, status TEXT,
  started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ
)
```

A synced table keeps a read-only copy of `gold.launch_forecasts` in Lakebase so charts load without
starting the warehouse.

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
| GET | `/api/uploads` | List uploads with status |
| GET | `/api/uploads/{id}/products` | Products of an upload with validation errors |
| PATCH | `/api/products/{id}` | Edit fields (requires `version`) |
| POST | `/api/products/approve` | Approve or reject a list of products |
| POST | `/api/publish` | MERGE approved products into silver |
| POST | `/api/forecast/run` | Start the forecast job |
| GET | `/api/forecast/runs/{run_id}` | Job run status |
| GET | `/api/forecast?client_id=` | Actuals plus forecast for charting |

## Permissions (app service principal)

* Lakebase database: connect and read/write on the app schema
* SQL warehouse: CAN USE
* Job `product_launch_forecast_job`: CAN MANAGE RUN
* Volume `bronze.raw_documents`: READ VOLUME, WRITE VOLUME
* Tables: MODIFY and SELECT on `silver.product_launches`, SELECT on `gold.launch_forecasts`

User identity is taken from the app request headers and stored in `uploaded_by` / `updated_by`.

## Prerequisites in the pipeline

To fix before building the app:

* Silver schema regression: `setup_catalog` and `run_forecast` use MAP columns, but extraction writes flat columns
* Extraction is not idempotent: every run re-reads all files and appends duplicates; `ai_parse_document` runs twice per file
* Gold forecast appends on every run instead of replacing the previous forecast

## Out of scope (v1)

* Email ingestion (existing volume drop path stays)
* Per-client row-level access control
* Genie Agent for natural-language questions (possible v2)
