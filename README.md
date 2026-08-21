# Product Launch Forecast

End-to-end Databricks solution that ingests semi-structured product launch documents from clients, extracts standardized data using AI, and generates forecasts.

## Architecture

```mermaid
flowchart LR
    subgraph Ingestion
        A[📧 Client Emails] --> B[UC Volume<br/>raw_documents]
    end

    subgraph Extraction
        B --> C[ai_parse_document<br/>PDF/DOCX → text]
        C --> D[ai_extract<br/>multilingual NER]
        D --> E[EXPLODE<br/>products array]
    end

    subgraph Storage
        E --> F[(Silver Table<br/>product_launches)]
        F --> G[ai_forecast<br/>12-week horizon]
        G --> H[(Gold Table<br/>launch_forecasts)]
    end

    subgraph Serving
        H --> I[📊 AI/BI Dashboard<br/>Client View]
        F --> I
    end

    style A fill:#f9f,stroke:#333
    style I fill:#bbf,stroke:#333
```

### Data Flow Detail

```mermaid
flowchart TD
    subgraph "Bronze (Raw)"
        V[/Volumes/.../raw_documents/]
    end

    subgraph "Silver (Standardized)"
        V -->|ai_parse_document| P[Parsed Text]
        P -->|ai_extract| J[JSON struct per doc]
        J -->|EXPLODE products| S[silver.product_launches<br/>1 row per product]
    end

    subgraph "Gold (Analytics)"
        S -->|DATE_TRUNC week + COUNT| TS[Weekly time series]
        TS -->|ai_forecast| F[gold.launch_forecasts<br/>forecast + confidence bands]
    end

    subgraph "Presentation"
        S --> D[Dashboard: KPIs + Table]
        F --> D[Dashboard: Combo Chart]
    end
```

## Pipeline Stages

| Stage | Notebook | Description |
| --- | --- | --- |
| Setup | `src/setup_catalog.sql` | Creates dedicated catalog, schemas, volumes, tables |
| Extraction | `src/extraction/extract_product_data.sql` | Parses any document format, extracts product fields |
| Forecasting | `src/forecasting/run_forecast.sql` | Generates 12-week forecasts per client |

## Deployment

### Prerequisites

1. Databricks CLI installed (`databricks --version`)
2. Workspace authentication configured
3. SQL warehouse with AI functions enabled

### Deploy to Development

```bash
databricks bundle deploy --target dev
```

### Deploy to Production

```bash
databricks bundle deploy --target prod
```

### Deploy to a New Workspace

1. Add a new target in `databricks.yml`
2. Set variables (catalog, warehouse_id)
3. Run: `databricks bundle deploy --target new_workspace`

## Usage

1. Drop client documents (PDF, DOCX, etc.) into the `raw_documents` volume
2. The daily job (8 AM) picks them up automatically
3. Or trigger manually: `databricks bundle run product_launch_forecast_job`
4. View forecasts in the gold table or connected dashboard
