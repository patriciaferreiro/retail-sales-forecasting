"""Lakebase Postgres connection pool with OAuth token rotation, plus schema bootstrap."""
import logging
import os
import threading
import time
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from databricks.sdk import WorkspaceClient

from .config import DB_SCHEMA, LAKEBASE_ENDPOINT

log = logging.getLogger(__name__)
w = WorkspaceClient()


class _TokenCache:
    """Mints Lakebase OAuth tokens (valid ~1h) and refreshes them before expiry."""

    def __init__(self, ttl_s: int = 45 * 60):
        self._ttl = ttl_s
        self._token = None
        self._expires = 0.0
        self._lock = threading.Lock()

    def get(self) -> str:
        with self._lock:
            if self._token is None or time.time() >= self._expires:
                cred = w.postgres.generate_database_credential(endpoint=LAKEBASE_ENDPOINT)
                self._token = cred.token
                self._expires = time.time() + self._ttl
            return self._token


_tokens = _TokenCache()


class _TokenConnection(psycopg.Connection):
    """Each new physical connection gets a fresh (cached) OAuth token as password."""

    @classmethod
    def connect(cls, conninfo: str = "", **kwargs):
        kwargs["password"] = _tokens.get()
        return super().connect(conninfo, **kwargs)


pool = ConnectionPool(
    conninfo="",
    connection_class=_TokenConnection,
    kwargs={
        "host": os.environ.get("PGHOST"),
        "port": int(os.environ.get("PGPORT", "5432")),
        "dbname": os.environ.get("PGDATABASE", "databricks_postgres"),
        "user": os.environ.get("PGUSER"),
        "sslmode": os.environ.get("PGSSLMODE", "require"),
        "application_name": os.environ.get("PGAPPNAME", "product-launch-forecast"),
        "row_factory": dict_row,
    },
    min_size=1,
    max_size=10,
    max_lifetime=40 * 60,  # recycle before the token expires
    open=False,
)


@contextmanager
def cursor():
    """One transaction per block: commits on success, rolls back on error."""
    with pool.connection() as conn:
        with conn.cursor() as cur:
            yield cur


S = DB_SCHEMA

DDL = f"""
CREATE SCHEMA IF NOT EXISTS {S};

CREATE TABLE IF NOT EXISTS {S}.uploads (
  upload_id    UUID PRIMARY KEY,
  file_name    TEXT NOT NULL,
  volume_path  TEXT NOT NULL,
  source_file  TEXT,
  status       TEXT NOT NULL DEFAULT 'uploaded',  -- uploaded | extracting | extracted | failed
  error        TEXT,
  uploaded_by  TEXT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  extracted_at TIMESTAMPTZ
);
-- Readable text of the document as parsed by ai_parse_document (for validation and AI suggestions)
ALTER TABLE {S}.uploads ADD COLUMN IF NOT EXISTS parsed_text TEXT;

CREATE TABLE IF NOT EXISTS {S}.review_products (
  product_id          UUID PRIMARY KEY,
  upload_id           UUID NOT NULL REFERENCES {S}.uploads(upload_id) ON DELETE CASCADE,
  client_id           TEXT,
  launch_date         DATE,
  launch_date_raw     TEXT,
  article_description TEXT,
  identifier_old      TEXT,
  identifier_new      TEXT,
  identifier_type     TEXT,
  size                TEXT,
  packaging           TEXT,
  category            TEXT,
  notes               TEXT,
  validation_errors   JSONB NOT NULL DEFAULT '[]'::jsonb,
  status              TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | published
  version             INT  NOT NULL DEFAULT 1,
  updated_by          TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS review_products_upload_idx ON {S}.review_products(upload_id);
CREATE INDEX IF NOT EXISTS review_products_status_idx ON {S}.review_products(status);
CREATE INDEX IF NOT EXISTS review_products_key_idx ON {S}.review_products(lower(client_id), identifier_new);

CREATE TABLE IF NOT EXISTS {S}.review_audit (
  audit_id   BIGSERIAL PRIMARY KEY,
  product_id UUID NOT NULL,
  field      TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_audit_product_idx ON {S}.review_audit(product_id);

CREATE TABLE IF NOT EXISTS {S}.forecast_runs (
  run_id        BIGINT PRIMARY KEY,
  triggered_by  TEXT,
  status        TEXT NOT NULL,
  state_message TEXT,
  run_page_url  TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);
"""


def init_db() -> None:
    pool.open(wait=True, timeout=60)
    with cursor() as cur:
        cur.execute(DDL)
    log.info("Lakebase schema %s ready", S)
