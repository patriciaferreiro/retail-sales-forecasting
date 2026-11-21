"""FastAPI backend for the Product Launch Forecast app.

Lakebase holds the review queue (fast, concurrent edits); Delta holds silver/gold.
All Databricks calls run as the app service principal; the end user's email from
the Databricks Apps proxy headers is recorded for audit.
"""
import hashlib
import io
import logging
import os
import re
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from . import config
from .db import S, cursor, init_db, w
from .extraction import extract_file, parse_text
from .suggestions import SERVING_ENDPOINT, ask_model
from .validation import has_errors, normalize_identifier, parse_date, validate
from .warehouse import SqlError, run_sql

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("app")

EDITABLE_FIELDS = (
    "client_id", "launch_date", "article_description", "identifier_old", "identifier_new",
    "identifier_type", "size", "packaging", "category", "notes",
)
ACTIVE_RUN_STATES = ("QUEUED", "PENDING", "RUNNING", "BLOCKED", "WAITING_FOR_RETRY", "TERMINATING")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Product Launch Forecast", lifespan=lifespan)


@app.exception_handler(SqlError)
async def _sql_error(_req, exc: SqlError):
    log.exception("SQL error")
    return JSONResponse(status_code=502, content={"detail": f"SQL warehouse error: {exc}"})


def current_user(request: Request) -> str:
    return (
        request.headers.get("X-Forwarded-Email")
        or request.headers.get("X-Forwarded-Preferred-Username")
        or "unknown"
    )


# --------------------------------------------------------------------------- helpers

_published_cache = {"at": 0.0, "keys": set()}
_published_lock = threading.Lock()


def published_keys(force: bool = False) -> set:
    """(lower(client_id), identifier_new) already in silver, cached for 5 minutes."""
    with _published_lock:
        if force or time.time() - _published_cache["at"] > 300:
            try:
                rows = run_sql(
                    f"SELECT DISTINCT lower(client_id) AS c, identifier_new AS i FROM {config.SILVER_TABLE} "
                    "WHERE client_id IS NOT NULL AND identifier_new IS NOT NULL"
                )
                _published_cache["keys"] = {(r["c"], r["i"]) for r in rows}
                _published_cache["at"] = time.time()
            except Exception as exc:  # keep serving with the last known set; retry in ~60s
                log.warning("Could not refresh published keys from silver: %s", exc)
                _published_cache["at"] = time.time() - 240
        return _published_cache["keys"]


def _dup_in_review(cur, row: dict) -> bool:
    if not row.get("client_id") or not row.get("identifier_new"):
        return False
    cur.execute(
        f"""SELECT 1 FROM {S}.review_products
            WHERE product_id <> %s AND status IN ('pending','approved')
              AND lower(client_id) = lower(%s) AND identifier_new = %s LIMIT 1""",
        (row["product_id"], row["client_id"], row["identifier_new"]),
    )
    return cur.fetchone() is not None


def _with_validation(cur, row: dict, keys: set) -> dict:
    if row["status"] in ("published", "rejected"):
        row["validation_errors"] = []
    else:
        row["validation_errors"] = validate(row, published_keys=keys, duplicate_in_review=_dup_in_review(cur, row))
    return row


def _clean_text(v):
    if v is None:
        return None
    v = str(v).strip()
    return v or None


def _safe_file_name(name: str) -> str:
    base = os.path.basename(name or "document")
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._") or "document"
    return base[:120]


# --------------------------------------------------------------------------- extraction

def run_extraction(upload_id) -> None:
    """Background task: parse + extract one upload, then load pending review rows."""
    upload_id = uuid.UUID(str(upload_id))
    with cursor() as cur:
        cur.execute(
            f"UPDATE {S}.uploads SET status='extracting', error=NULL WHERE upload_id=%s RETURNING volume_path, uploaded_by",
            (upload_id,),
        )
        up = cur.fetchone()
    if not up:
        return
    try:
        result = extract_file(up["volume_path"])
        if result["parse_error"]:
            raise RuntimeError(f"Document could not be parsed: {result['parse_error']}")
        if not result["rows"]:
            detail = f": {result['extract_error']}" if result.get("extract_error") else ""
            raise RuntimeError(f"No products were found in the document{detail}")
        keys = published_keys()
        with cursor() as cur:
            cur.execute(f"DELETE FROM {S}.review_products WHERE upload_id=%s AND status <> 'published'", (upload_id,))
            for r in result["rows"]:
                row = {
                    "product_id": uuid.uuid4(),
                    "status": "pending",
                    "client_id": _clean_text(r.get("client_id")),
                    "launch_date_raw": _clean_text(r.get("launch_date_raw")),
                    "launch_date": parse_date(r.get("launch_date_raw")),
                    "article_description": _clean_text(r.get("article_description")),
                    "identifier_old": normalize_identifier(r.get("identifier_old")),
                    "identifier_new": normalize_identifier(r.get("identifier_new")),
                    "identifier_type": _clean_text(r.get("identifier_type")),
                    "size": _clean_text(r.get("size")),
                    "packaging": _clean_text(r.get("packaging")),
                    "category": _clean_text(r.get("category")),
                    "notes": _clean_text(r.get("notes")),
                }
                issues = validate(row, published_keys=keys, duplicate_in_review=_dup_in_review(cur, row))
                cur.execute(
                    f"""INSERT INTO {S}.review_products
                        (product_id, upload_id, client_id, launch_date, launch_date_raw, article_description,
                         identifier_old, identifier_new, identifier_type, size, packaging, category, notes,
                         validation_errors, status, updated_by)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'pending','extraction')""",
                    (row["product_id"], upload_id, row["client_id"], row["launch_date"], row["launch_date_raw"],
                     row["article_description"], row["identifier_old"], row["identifier_new"],
                     row["identifier_type"], row["size"], row["packaging"], row["category"], row["notes"],
                     Jsonb(issues)),
                )
            cur.execute(
                f"""UPDATE {S}.uploads SET status='extracted', source_file=%s, parsed_text=%s, extracted_at=now()
                    WHERE upload_id=%s""",
                (result["source_file"], result.get("parsed_text"), upload_id),
            )
    except Exception as exc:  # surface any failure on the upload row
        log.exception("Extraction failed for %s", upload_id)
        with cursor() as cur:
            cur.execute(f"UPDATE {S}.uploads SET status='failed', error=%s WHERE upload_id=%s", (str(exc)[:2000], upload_id))


# --------------------------------------------------------------------------- API: misc

@app.get("/api/health")
def health():
    with cursor() as cur:
        cur.execute("SELECT 1 AS ok")
        cur.fetchone()
    return {"status": "ok", "warehouse": bool(config.WAREHOUSE_ID), "job": bool(config.FORECAST_JOB_ID)}


@app.get("/api/architecture")
def architecture():
    """The Databricks components this deployment actually uses (from its configuration), for the Architecture view."""
    host = (w.config.host or "").rstrip("/")
    parts = (config.LAKEBASE_ENDPOINT or "").split("/")  # projects/<p>/branches/<b>/endpoints/<e>
    lb = dict(zip(parts[0::2], parts[1::2]))
    cat = config.CATALOG

    def table_url(full):
        c, s, t = full.split(".")
        return f"{host}/explore/data/{c}/{s}/{t}"

    app_name = os.environ.get("DATABRICKS_APP_NAME", "product-launch-forecast")
    return {
        "host": host,
        "app": {"name": app_name, "url": f"{host}/apps/{app_name}"},
        "catalog": {"name": cat, "url": f"{host}/explore/data/{cat}"},
        "volume": {"name": f"{cat}.bronze.raw_documents", "path": config.VOLUME_ROOT, "uploads": config.UPLOAD_ROOT,
                   "url": f"{host}/explore/data/volumes/{cat}/bronze/raw_documents"},
        "warehouse": {"id": config.WAREHOUSE_ID, "url": f"{host}/sql/warehouses/{config.WAREHOUSE_ID}" if config.WAREHOUSE_ID else None},
        "silver": {"name": config.SILVER_TABLE, "url": table_url(config.SILVER_TABLE)},
        "gold": {"name": config.GOLD_TABLE, "url": table_url(config.GOLD_TABLE)},
        "job": {"id": config.FORECAST_JOB_ID, "tasks": config.FORECAST_TASK_KEYS,
                "url": f"{host}/jobs/{config.FORECAST_JOB_ID}" if config.FORECAST_JOB_ID else None},
        "lakebase": {"project": lb.get("projects"), "branch": lb.get("branches"), "endpoint": lb.get("endpoints"),
                     "database": os.environ.get("PGDATABASE", "databricks_postgres"), "schema": S,
                     "tables": ["uploads", "review_products", "review_audit", "ai_suggestions", "forecast_runs"],
                     "synced_table": config.FORECAST_SYNCED_TABLE or None},
        "model": {"name": SERVING_ENDPOINT, "url": f"{host}/ml/endpoints/{SERVING_ENDPOINT}"},
    }


@app.get("/api/me")
def me(request: Request):
    return {"email": current_user(request)}


# --------------------------------------------------------------------------- API: uploads

@app.post("/api/uploads")
def create_uploads(request: Request, background: BackgroundTasks, files: list[UploadFile] = File(...)):
    user = current_user(request)
    created = []
    for f in files:
        upload_id = str(uuid.uuid4())
        name = _safe_file_name(f.filename)
        path = f"{config.UPLOAD_ROOT}/{upload_id}/{name}"
        data = f.file.read(config.MAX_UPLOAD_BYTES + 1)
        if len(data) > config.MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"{f.filename} is larger than 50 MB")
        if not data:
            raise HTTPException(400, f"{f.filename} is empty")
        w.files.upload(path, io.BytesIO(data), overwrite=True)
        with cursor() as cur:
            cur.execute(
                f"INSERT INTO {S}.uploads (upload_id, file_name, volume_path, uploaded_by) VALUES (%s,%s,%s,%s)",
                (uuid.UUID(upload_id), f.filename or name, path, user),
            )
        background.add_task(run_extraction, upload_id)
        created.append({"upload_id": upload_id, "file_name": f.filename, "status": "uploaded"})
    return {"uploads": created}


@app.get("/api/uploads")
def list_uploads():
    with cursor() as cur:
        cur.execute(
            f"""SELECT u.upload_id, u.file_name, u.status, u.error, u.uploaded_by, u.uploaded_at, u.extracted_at,
                       count(p.product_id) AS total,
                       count(*) FILTER (WHERE p.status='pending')   AS pending,
                       count(*) FILTER (WHERE p.status='approved')  AS approved,
                       count(*) FILTER (WHERE p.status='rejected')  AS rejected,
                       count(*) FILTER (WHERE p.status='published') AS published,
                       -- vendors = distinct product Client values (trimmed), for the vendor filter
                       COALESCE(array_agg(DISTINCT btrim(p.client_id))
                                FILTER (WHERE p.client_id IS NOT NULL AND btrim(p.client_id) <> ''),
                                ARRAY[]::text[]) AS vendors
                FROM {S}.uploads u LEFT JOIN {S}.review_products p USING (upload_id)
                GROUP BY u.upload_id ORDER BY u.uploaded_at DESC LIMIT 200"""
        )
        return {"uploads": cur.fetchall()}


@app.post("/api/uploads/{upload_id}/retry")
def retry_upload(upload_id: uuid.UUID, background: BackgroundTasks):
    with cursor() as cur:
        cur.execute(f"SELECT status FROM {S}.uploads WHERE upload_id=%s", (upload_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Upload not found")
    if row["status"] == "extracting":
        raise HTTPException(409, "Extraction is already running")
    background.add_task(run_extraction, str(upload_id))
    return {"status": "extracting"}


@app.get("/api/uploads/{upload_id}/products")
def upload_products(upload_id: uuid.UUID):
    keys = published_keys()
    with cursor() as cur:
        cur.execute(
            f"SELECT * FROM {S}.review_products WHERE upload_id=%s ORDER BY article_description NULLS LAST, product_id",
            (upload_id,),
        )
        rows = cur.fetchall()
        return {"products": [_with_validation(cur, r, keys) for r in rows]}


# --------------------------------------------------------------------------- API: ingestion check

# Only these types are rendered inline by the browser; everything else is a download
_INLINE_TYPES = {
    ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".tif": "image/tiff", ".tiff": "image/tiff",
}


@app.get("/api/uploads/{upload_id}/file")
def upload_file(upload_id: uuid.UUID):
    """Serve the original uploaded document. The path comes from the uploads row, never from the client."""
    with cursor() as cur:
        cur.execute(f"SELECT file_name, volume_path FROM {S}.uploads WHERE upload_id=%s", (upload_id,))
        row = cur.fetchone()
    if not row or not row["volume_path"].startswith(config.UPLOAD_ROOT + "/"):
        raise HTTPException(404, "Upload not found")
    path = row["volume_path"]
    try:
        resp = w.files.download(path)
    except Exception as exc:
        log.warning("Could not download %s: %s", path, exc)
        raise HTTPException(404, "File not found in the volume")
    if resp.content_length and resp.content_length > config.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File is larger than 50 MB")
    data = resp.contents.read(config.MAX_UPLOAD_BYTES + 1)
    if len(data) > config.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File is larger than 50 MB")
    media = _INLINE_TYPES.get(os.path.splitext(path)[1].lower())
    disposition = "inline" if media else "attachment"
    return Response(
        content=data,
        media_type=media or "application/octet-stream",
        headers={
            "Content-Disposition": f'{disposition}; filename="{_safe_file_name(row["file_name"])}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=300",
        },
    )


def get_parsed_text(upload_id: uuid.UUID) -> str | None:
    """Stored document text; uploads that predate the column are parsed once and cached."""
    with cursor() as cur:
        cur.execute(f"SELECT volume_path, parsed_text FROM {S}.uploads WHERE upload_id=%s", (upload_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Upload not found")
    if row["parsed_text"]:
        return row["parsed_text"]
    text = parse_text(row["volume_path"])
    if text:
        with cursor() as cur:
            cur.execute(f"UPDATE {S}.uploads SET parsed_text=%s WHERE upload_id=%s AND parsed_text IS NULL",
                        (text, upload_id))
    return text


@app.get("/api/uploads/{upload_id}/text")
def upload_text(upload_id: uuid.UUID):
    return {"upload_id": upload_id, "text": get_parsed_text(upload_id)}


def _as_text(v):
    if v is None:
        return None
    return v.isoformat() if isinstance(v, (date, datetime)) else str(v)


@app.get("/api/uploads/{upload_id}/fields")
def upload_fields(upload_id: uuid.UUID):
    """Per product and field: value as extracted, current value, whether it was edited, validation issues."""
    keys = published_keys()
    with cursor() as cur:
        cur.execute(
            f"""SELECT upload_id, file_name, volume_path, status, error, uploaded_by, uploaded_at, extracted_at
                FROM {S}.uploads WHERE upload_id=%s""",
            (upload_id,),
        )
        upload = cur.fetchone()
        if not upload:
            raise HTTPException(404, "Upload not found")
        cur.execute(
            f"SELECT * FROM {S}.review_products WHERE upload_id=%s ORDER BY article_description NULLS LAST, product_id",
            (upload_id,),
        )
        rows = [_with_validation(cur, r, keys) for r in cur.fetchall()]
        first_old: dict = {}
        if rows:
            # The first audit entry per field holds the value before any human edit, i.e. as extracted
            cur.execute(
                f"""SELECT DISTINCT ON (product_id, field) product_id, field, old_value
                    FROM {S}.review_audit
                    WHERE product_id = ANY(%s) AND field <> 'status'
                    ORDER BY product_id, field, changed_at, audit_id""",
                ([r["product_id"] for r in rows],),
            )
            first_old = {(a["product_id"], a["field"]): a["old_value"] for a in cur.fetchall()}

    products, filled, with_errors, with_warnings, edited_count = [], 0, 0, 0, 0
    for r in rows:
        fields = []
        for f in EDITABLE_FIELDS:
            current = _as_text(r.get(f))
            edited = (r["product_id"], f) in first_old
            if edited:
                extracted = first_old[(r["product_id"], f)]
            elif f == "launch_date" and r.get("launch_date_raw"):
                extracted = r["launch_date_raw"]  # raw text, e.g. '15.02.2027' or 'KW 12'
            else:
                extracted = current
            issues = [i for i in r["validation_errors"] if i["field"] == f]
            status = "error" if any(i["severity"] == "error" for i in issues) else "warning" if issues else "ok"
            filled += current is not None
            with_errors += status == "error"
            with_warnings += status == "warning"
            edited_count += edited
            fields.append({"field": f, "extracted": extracted, "current": current, "edited": edited,
                           "status": status, "issues": issues})
        products.append({"product_id": r["product_id"], "status": r["status"], "version": r["version"],
                         "article_description": r["article_description"], "fields": fields})

    ext = os.path.splitext(upload["volume_path"])[1].lower()
    return {
        "upload": {**{k: v for k, v in upload.items() if k != "volume_path"}, "preview": "image" if ext in (".png", ".jpg", ".jpeg") else
                   "pdf" if ext == ".pdf" else "tiff" if ext in (".tif", ".tiff") else "download"},
        "summary": {
            "products": len(products),
            "fields_expected": len(products) * len(EDITABLE_FIELDS),
            "fields_filled": filled,
            "fields_with_errors": with_errors,
            "fields_with_warnings": with_warnings,
            "fields_edited": edited_count,
        },
        "products": products,
    }


def _norm(s: str) -> str:
    return re.sub(r"[\s\-_.,;:/|]+", "", s).lower()


def found_in_document(field: str, value, doc_norm: str | None):
    """True/False if the value occurs in the document text (whitespace/punctuation-insensitive), None if unknown."""
    if value in (None, "") or doc_norm is None:
        return None
    candidates = [str(value)]
    if field == "launch_date":
        d = parse_date(value)
        if d:  # documents usually print European formats
            candidates += [d.strftime("%d.%m.%Y"), d.strftime("%d/%m/%Y"), d.strftime("%d-%m-%Y"), d.strftime("%d.%m.%y")]
    return any(_norm(c) and _norm(c) in doc_norm for c in candidates)


@app.get("/api/products/{product_id}/detail")
def product_detail(product_id: uuid.UUID):
    """One product with its fields (extracted vs current, checks, found in document) and neighbours."""
    keys = published_keys()
    with cursor() as cur:
        cur.execute(f"SELECT * FROM {S}.review_products WHERE product_id=%s", (product_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Product not found")
        row = _with_validation(cur, row, keys)
        cur.execute(
            f"""SELECT upload_id, file_name, volume_path, status, error, uploaded_by, uploaded_at, extracted_at
                FROM {S}.uploads WHERE upload_id=%s""",
            (row["upload_id"],),
        )
        upload = cur.fetchone()
        cur.execute(
            f"""SELECT product_id FROM {S}.review_products WHERE upload_id=%s
                ORDER BY article_description NULLS LAST, product_id""",
            (row["upload_id"],),
        )
        order = [r["product_id"] for r in cur.fetchall()]
        cur.execute(
            f"""SELECT DISTINCT ON (field) field, old_value FROM {S}.review_audit
                WHERE product_id=%s AND field <> 'status' ORDER BY field, changed_at, audit_id""",
            (product_id,),
        )
        first_old = {a["field"]: a["old_value"] for a in cur.fetchall()}

    try:
        doc_text = get_parsed_text(row["upload_id"])
    except Exception as exc:  # preview still works without text
        log.warning("No document text for %s: %s", row["upload_id"], exc)
        doc_text = None
    doc_norm = _norm(doc_text) if doc_text else None

    fields = []
    for f in EDITABLE_FIELDS:
        current = _as_text(row.get(f))
        edited = f in first_old
        if edited:
            extracted = first_old[f]
        elif f == "launch_date" and row.get("launch_date_raw"):
            extracted = row["launch_date_raw"]
        else:
            extracted = current
        issues = [i for i in row["validation_errors"] if i["field"] == f]
        status = "error" if any(i["severity"] == "error" for i in issues) else "warning" if issues else "ok"
        fields.append({
            "field": f, "extracted": extracted, "current": current, "edited": edited,
            "status": status, "issues": issues,
            "found_in_document": found_in_document(f, current, doc_norm),
        })

    idx = order.index(product_id) if product_id in order else -1
    ext = os.path.splitext(upload["volume_path"])[1].lower()
    return {
        "product": {k: row[k] for k in ("product_id", "upload_id", "status", "version", "article_description",
                                          "updated_by", "updated_at")},
        "upload": {**{k: v for k, v in upload.items() if k != "volume_path"},
                   "preview": "image" if ext in (".png", ".jpg", ".jpeg") else "pdf" if ext == ".pdf" else "download"},
        "fields": fields,
        "has_document_text": doc_text is not None,
        "position": idx + 1,
        "total": len(order),
        "prev_id": order[idx - 1] if idx > 0 else None,
        "next_id": order[idx + 1] if 0 <= idx < len(order) - 1 else None,
    }


# --------------------------------------------------------------------------- API: AI suggestions

class SuggestRequest(BaseModel):
    field: str | None = None  # one field, or all fields with errors


@app.post("/api/products/{product_id}/suggest")
def suggest_fixes(product_id: uuid.UUID, body: SuggestRequest, request: Request):
    """Ask the model for fixes; every suggestion is re-validated and stored, never applied automatically."""
    user = current_user(request)
    keys = published_keys()
    with cursor() as cur:
        cur.execute(f"SELECT * FROM {S}.review_products WHERE product_id=%s", (product_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Product not found")
        if row["status"] == "published":
            raise HTTPException(409, "Published products cannot be changed")
        row = _with_validation(cur, row, keys)
        cur.execute(
            f"""SELECT article_description, identifier_old, identifier_new, identifier_type, size, packaging, category
                FROM {S}.review_products WHERE upload_id=%s AND product_id<>%s
                ORDER BY article_description NULLS LAST""",
            (row["upload_id"], product_id),
        )
        siblings = cur.fetchall()
        cur.execute(
            f"""SELECT DISTINCT ON (field) field, old_value FROM {S}.review_audit
                WHERE product_id=%s AND field <> 'status' ORDER BY field, changed_at, audit_id""",
            (product_id,),
        )
        extracted = {a["field"]: a["old_value"] for a in cur.fetchall()}  # values before human edits

    issues = row["validation_errors"]
    if body.field:
        if body.field not in EDITABLE_FIELDS:
            raise HTTPException(400, f"Field not editable: {body.field}")
        fields = [body.field]
    else:
        err = {i["field"] for i in issues if i["severity"] == "error"}
        fields = [f for f in EDITABLE_FIELDS if f in err]
    if not fields:
        raise HTTPException(400, "This product has no errors to fix")

    doc_text = get_parsed_text(row["upload_id"])
    product = {f: _as_text(row.get(f)) for f in EDITABLE_FIELDS}
    try:
        result = ask_model(doc_text, product, fields, issues, siblings, extracted)
    except Exception as exc:
        log.exception("AI suggestion failed for %s", product_id)
        raise HTTPException(502, f"AI suggestion failed: {exc}")

    doc_norm = _norm(doc_text) if doc_text else None
    stored = []
    with cursor() as cur:
        # A fresh suggestion replaces any open one for the same field
        cur.execute(
            f"""UPDATE {S}.ai_suggestions SET status='superseded'
                WHERE product_id=%s AND status='suggested' AND field = ANY(%s)""",
            (product_id, fields),
        )
        for s in result["suggestions"]:
            f, action, value = s["field"], s["action"], s["suggested_value"]
            if action == "change" and f in ("identifier_old", "identifier_new"):
                value = normalize_identifier(value)
            if action == "change" and f == "launch_date":
                d = parse_date(value)
                value = d.isoformat() if d else value
            still_invalid, messages = None, []
            if action in ("change", "clear"):
                new_val = None if action == "clear" else (parse_date(value) if f == "launch_date" else value)
                merged = {**row, f: new_val}
                if f == "launch_date":
                    merged["launch_date_raw"] = value if new_val is None and action == "change" else None
                checked = validate(merged, published_keys=keys, duplicate_in_review=_dup_in_review(cur, merged))
                messages = [i for i in checked if i["field"] == f]
                still_invalid = any(i["severity"] == "error" for i in messages)
            quote = s["evidence_quote"].strip()
            # Every cited line (or '...'-separated passage) must occur in the document text
            parts = [p for p in re.split(r"\n|\.\.\.|\u2026", quote) if _norm(p)]
            evidence_found = bool(parts) and doc_norm is not None and all(_norm(p) in doc_norm for p in parts)
            rec = {
                "suggestion_id": uuid.uuid4(), "product_id": product_id, "field": f, "action": action,
                "current_value": product.get(f), "suggested_value": value, "confidence": s["confidence"],
                "reason": s["reason"], "evidence_quote": quote or None, "evidence_found": evidence_found,
                "value_in_document": found_in_document(f, value, doc_norm) if value else None,
                "still_invalid": still_invalid, "validation_messages": messages,
                "product_note": result["product_note"] or None, "model": result["model"],
                "based_on_version": row["version"], "status": "suggested", "created_by": user,
            }
            cur.execute(
                f"""INSERT INTO {S}.ai_suggestions
                    (suggestion_id, product_id, field, action, current_value, suggested_value, confidence, reason,
                     evidence_quote, evidence_found, value_in_document, still_invalid, validation_messages,
                     product_note, model, based_on_version, status, created_by)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (*[rec[k] for k in ("suggestion_id", "product_id", "field", "action", "current_value",
                                    "suggested_value", "confidence", "reason", "evidence_quote", "evidence_found",
                                    "value_in_document", "still_invalid")],
                 Jsonb(messages), rec["product_note"], rec["model"], rec["based_on_version"], "suggested", user),
            )
            stored.append(rec)
    return {"product_id": product_id, "version": row["version"], "fields": fields,
            "suggestions": stored, "product_note": result["product_note"], "model": result["model"]}


@app.get("/api/products/{product_id}/suggestions")
def open_suggestions(product_id: uuid.UUID):
    with cursor() as cur:
        cur.execute(
            f"SELECT * FROM {S}.ai_suggestions WHERE product_id=%s AND status='suggested' ORDER BY created_at",
            (product_id,),
        )
        return {"suggestions": cur.fetchall()}


class ApplyRequest(BaseModel):
    version: int  # product version the reviewer is looking at


@app.post("/api/suggestions/{suggestion_id}/apply")
def apply_suggestion(suggestion_id: uuid.UUID, body: ApplyRequest, request: Request):
    user = current_user(request)
    with cursor() as cur:
        cur.execute(f"SELECT * FROM {S}.ai_suggestions WHERE suggestion_id=%s", (suggestion_id,))
        s = cur.fetchone()
    if not s:
        raise HTTPException(404, "Suggestion not found")
    if s["status"] != "suggested":
        raise HTTPException(409, f"Suggestion already {s['status']}")
    if s["action"] == "no_change":
        raise HTTPException(400, "This suggestion proposes no change; dismiss it instead")
    value = s["suggested_value"] if s["action"] == "change" else None
    updated = apply_product_changes(
        s["product_id"], ProductPatch(version=body.version, changes={s["field"]: value}), f"{user} (AI suggestion)"
    )
    with cursor() as cur:
        cur.execute(
            f"""UPDATE {S}.ai_suggestions SET status='applied', decided_by=%s, decided_at=now()
                WHERE suggestion_id=%s AND status='suggested'""",
            (user, suggestion_id),
        )
    return {"suggestion_id": suggestion_id, "product": updated}


@app.post("/api/suggestions/{suggestion_id}/dismiss")
def dismiss_suggestion(suggestion_id: uuid.UUID, request: Request):
    with cursor() as cur:
        cur.execute(
            f"""UPDATE {S}.ai_suggestions SET status='dismissed', decided_by=%s, decided_at=now()
                WHERE suggestion_id=%s AND status='suggested' RETURNING suggestion_id""",
            (current_user(request), suggestion_id),
        )
        if not cur.fetchone():
            raise HTTPException(409, "Suggestion not found or already decided")
    return {"suggestion_id": suggestion_id, "status": "dismissed"}


# --------------------------------------------------------------------------- API: review edits

class ProductPatch(BaseModel):
    version: int
    changes: dict


@app.patch("/api/products/{product_id}")
def patch_product(product_id: uuid.UUID, body: ProductPatch, request: Request):
    return apply_product_changes(product_id, body, current_user(request))


def apply_product_changes(product_id: uuid.UUID, body: ProductPatch, user: str):
    """Version-checked edit with audit trail; shared by manual edits and applied AI suggestions."""
    unknown = set(body.changes) - set(EDITABLE_FIELDS)
    if unknown:
        raise HTTPException(400, f"Fields not editable: {sorted(unknown)}")

    changes = {}
    for k, v in body.changes.items():
        if k == "launch_date":
            if v in (None, ""):
                changes[k] = None
            else:
                d = parse_date(v)
                if d is None:
                    raise HTTPException(422, f"Invalid date: {v}")
                changes[k] = d
        elif k in ("identifier_old", "identifier_new"):
            changes[k] = normalize_identifier(v)
        else:
            changes[k] = _clean_text(v)

    keys = published_keys()
    with cursor() as cur:
        cur.execute(f"SELECT * FROM {S}.review_products WHERE product_id=%s FOR UPDATE", (product_id,))
        current = cur.fetchone()
        if not current:
            raise HTTPException(404, "Product not found")
        if current["version"] != body.version:
            raise HTTPException(409, {"message": f"Changed by {current['updated_by']} in the meantime",
                                      "current": _jsonable(_with_validation(cur, current, keys))})
        if current["status"] == "published":
            raise HTTPException(409, {"message": "Published rows cannot be edited", "current": _jsonable(current)})

        merged = {**current, **changes}
        if "launch_date" in changes:
            merged["launch_date_raw"] = None
        # Editing an approved row sends it back to review
        new_status = "pending" if current["status"] == "approved" else current["status"]
        merged["status"] = new_status
        issues = validate(merged, published_keys=keys, duplicate_in_review=_dup_in_review(cur, merged))

        sets = ", ".join(f"{k}=%s" for k in changes)
        cur.execute(
            f"""UPDATE {S}.review_products
                SET {sets + ',' if sets else ''} launch_date_raw=%s, validation_errors=%s, status=%s,
                    version=version+1, updated_by=%s, updated_at=now()
                WHERE product_id=%s AND version=%s RETURNING *""",
            (*changes.values(), merged["launch_date_raw"], Jsonb(issues), new_status, user,
             product_id, body.version),
        )
        updated = cur.fetchone()
        for k, v in changes.items():
            old = current.get(k)
            if (str(old) if old is not None else None) != (str(v) if v is not None else None):
                cur.execute(
                    f"INSERT INTO {S}.review_audit (product_id, field, old_value, new_value, changed_by) VALUES (%s,%s,%s,%s,%s)",
                    (product_id, k, None if old is None else str(old), None if v is None else str(v), user),
                )
        updated["validation_errors"] = issues
        return updated


class StatusItem(BaseModel):
    product_id: uuid.UUID
    version: int


class StatusChange(BaseModel):
    status: str  # approved | rejected | pending
    items: list[StatusItem]


@app.post("/api/products/status")
def set_status(body: StatusChange, request: Request):
    if body.status not in ("approved", "rejected", "pending"):
        raise HTTPException(400, "status must be approved, rejected or pending")
    user = current_user(request)
    keys = published_keys()
    updated, conflicts, blocked = [], [], []
    with cursor() as cur:
        for item in body.items:
            pid = item.product_id
            cur.execute(f"SELECT * FROM {S}.review_products WHERE product_id=%s FOR UPDATE", (pid,))
            row = cur.fetchone()
            if not row:
                continue
            if row["version"] != item.version or row["status"] == "published":
                conflicts.append(pid)
                continue
            if body.status == "approved":
                issues = validate(row, published_keys=keys, duplicate_in_review=_dup_in_review(cur, row))
                if has_errors(issues):
                    blocked.append(pid)
                    continue
            cur.execute(
                f"""UPDATE {S}.review_products SET status=%s, version=version+1, updated_by=%s, updated_at=now()
                    WHERE product_id=%s AND version=%s RETURNING product_id""",
                (body.status, user, pid, item.version),
            )
            if cur.fetchone():
                cur.execute(
                    f"INSERT INTO {S}.review_audit (product_id, field, old_value, new_value, changed_by) VALUES (%s,'status',%s,%s,%s)",
                    (pid, row["status"], body.status, user),
                )
                updated.append(pid)
            else:
                conflicts.append(pid)
    return {"updated": updated, "conflicts": conflicts, "blocked": blocked}


@app.get("/api/products/{product_id}/audit")
def product_audit(product_id: uuid.UUID):
    with cursor() as cur:
        cur.execute(
            f"SELECT field, old_value, new_value, changed_by, changed_at FROM {S}.review_audit WHERE product_id=%s ORDER BY changed_at DESC",
            (product_id,),
        )
        return {"audit": cur.fetchall()}


# --------------------------------------------------------------------------- API: publish

SILVER_COLS = (
    "document_id", "client_id", "launch_date", "article_description", "identifier_old", "identifier_new",
    "identifier_type", "size", "packaging", "category", "notes", "extracted_at", "source_file",
)


class PublishRequest(BaseModel):
    upload_id: uuid.UUID | None = None
    # Optional: only these products (e.g. the ones visible under a vendor filter)
    product_ids: list[uuid.UUID] | None = None


@app.post("/api/publish")
def publish(body: PublishRequest, request: Request):
    """MERGE approved rows into silver (idempotent on document_id), then mark them published."""
    user = current_user(request)
    with cursor() as cur:
        q = f"""SELECT p.*, u.source_file, u.volume_path FROM {S}.review_products p JOIN {S}.uploads u USING (upload_id)
                WHERE p.status='approved'"""
        args: tuple = ()
        if body.upload_id:
            q += " AND p.upload_id=%s"
            args = (body.upload_id,)
        if body.product_ids is not None:
            q += " AND p.product_id = ANY(%s)"
            args = (*args, body.product_ids)
        cur.execute(q, args)
        rows = cur.fetchall()
    if not rows:
        return {"published": 0}

    # document_id matches the pipeline: md5(file_path || article_description)
    for batch_start in range(0, len(rows), 50):
        batch = rows[batch_start:batch_start + 50]
        params, values = {}, []
        for i, r in enumerate(batch):
            src = r["source_file"] or r["volume_path"]
            r["document_id"] = hashlib.md5(f"{src}{r['article_description']}".encode()).hexdigest()
            r["_src"] = src
            cells = []
            for c in SILVER_COLS:
                if c == "extracted_at":
                    cells.append("current_timestamp()")
                    continue
                name = f"{c}_{i}"
                params[name] = r["_src"] if c == "source_file" else (r[c].isoformat() if isinstance(r[c], date) else r[c])
                cells.append(f"CAST(:{name} AS DATE)" if c == "launch_date" else f":{name}")
            values.append("(" + ", ".join(cells) + ")")
        run_sql(
            f"""MERGE INTO {config.SILVER_TABLE} AS t
                USING (SELECT * FROM VALUES {', '.join(values)} AS v({', '.join(SILVER_COLS)})) AS s
                ON t.document_id = s.document_id
                WHEN MATCHED THEN UPDATE SET *
                WHEN NOT MATCHED THEN INSERT *""",
            params,
        )

    with cursor() as cur:
        for r in rows:
            cur.execute(
                f"""UPDATE {S}.review_products SET status='published', published_at=now(), version=version+1,
                    updated_by=%s, updated_at=now() WHERE product_id=%s""",
                (user, r["product_id"]),
            )
            cur.execute(
                f"INSERT INTO {S}.review_audit (product_id, field, old_value, new_value, changed_by) VALUES (%s,'status','approved','published',%s)",
                (r["product_id"], user),
            )
    published_keys(force=True)
    _forecast_cache.clear()
    return {"published": len(rows)}


# --------------------------------------------------------------------------- API: forecast job

def _refresh_run(cur, run_id: int) -> dict:
    run = w.jobs.get_run(run_id)
    state = run.state
    life = state.life_cycle_state.value if state and state.life_cycle_state else "UNKNOWN"
    result = state.result_state.value if state and state.result_state else None
    status = result or life
    finished = None
    if run.end_time:
        finished = datetime.fromtimestamp(run.end_time / 1000, tz=timezone.utc)
    cur.execute(
        f"""UPDATE {S}.forecast_runs SET status=%s, state_message=%s, run_page_url=%s, finished_at=%s
            WHERE run_id=%s RETURNING *""",
        (status, state.state_message if state else None, run.run_page_url, finished, run_id),
    )
    if status == "SUCCESS":
        _forecast_cache.clear()
    return cur.fetchone()


@app.post("/api/forecast/run")
def start_forecast(request: Request):
    if not config.FORECAST_JOB_ID:
        raise HTTPException(500, "Forecast job is not configured")
    user = current_user(request)
    with cursor() as cur:
        # Serialize starts across users and app instances
        cur.execute("SELECT pg_advisory_xact_lock(hashtext('forecast_run'))")
        cur.execute(f"SELECT run_id FROM {S}.forecast_runs WHERE status = ANY(%s)", (list(ACTIVE_RUN_STATES),))
        for r in cur.fetchall():
            refreshed = _refresh_run(cur, r["run_id"])
            if refreshed and refreshed["status"] in ACTIVE_RUN_STATES:
                raise HTTPException(409, {"message": "A forecast run is already in progress", "run": _jsonable(refreshed)})
        waiter = w.jobs.run_now(job_id=config.FORECAST_JOB_ID, only=config.FORECAST_TASK_KEYS)
        run_id = getattr(waiter, "run_id", None) or waiter.response.run_id
        cur.execute(
            f"INSERT INTO {S}.forecast_runs (run_id, triggered_by, status) VALUES (%s,%s,'PENDING') RETURNING *",
            (run_id, user),
        )
        return cur.fetchone()


@app.get("/api/forecast/runs")
def list_runs():
    with cursor() as cur:
        cur.execute(f"SELECT * FROM {S}.forecast_runs ORDER BY started_at DESC LIMIT 20")
        return {"runs": cur.fetchall()}


@app.get("/api/forecast/runs/{run_id}")
def get_run(run_id: int):
    with cursor() as cur:
        cur.execute(f"SELECT * FROM {S}.forecast_runs WHERE run_id=%s", (run_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Run not found")
        if row["status"] in ACTIVE_RUN_STATES:
            row = _refresh_run(cur, run_id)
        return row


# --------------------------------------------------------------------------- API: forecast data

_forecast_cache: dict = {}


def _missing_table(exc: Exception) -> bool:
    return "TABLE_OR_VIEW_NOT_FOUND" in str(exc)


def _forecast_rows() -> tuple[list[dict], str]:
    """Forecast from the Lakebase synced table when available, else from gold via the warehouse."""
    if config.FORECAST_SYNCED_TABLE:
        try:
            with cursor() as cur:
                cur.execute(
                    f"SELECT client_id, ds, metric_forecast, metric_lower, metric_upper, forecast_generated_at "
                    f"FROM {config.FORECAST_SYNCED_TABLE} ORDER BY client_id, ds"
                )
                rows = cur.fetchall()
            return [{**r, "ds": r["ds"].isoformat()} for r in rows], "lakebase"
        except Exception as exc:
            log.warning("Synced forecast table unavailable, falling back to warehouse: %s", exc)
    try:
        rows = run_sql(
            f"SELECT client_id, CAST(ds AS STRING) AS ds, metric_forecast, metric_lower, metric_upper, "
            f"CAST(forecast_generated_at AS STRING) AS forecast_generated_at FROM {config.GOLD_TABLE} ORDER BY client_id, ds"
        )
    except SqlError as exc:
        if _missing_table(exc):
            return [], "warehouse"
        raise
    for r in rows:
        for k in ("metric_forecast", "metric_lower", "metric_upper"):
            r[k] = float(r[k]) if r[k] is not None else None
    return rows, "warehouse"


def _actual_rows() -> list[dict]:
    try:
        rows = run_sql(
            f"""SELECT client_id, CAST(DATE_TRUNC('week', launch_date) AS DATE) AS ds, COUNT(*) AS n_launches
                FROM {config.SILVER_TABLE} WHERE launch_date IS NOT NULL AND client_id IS NOT NULL
                GROUP BY 1, 2 ORDER BY 1, 2"""
        )
    except SqlError as exc:
        if _missing_table(exc):
            return []
        raise
    return [{"client_id": r["client_id"], "ds": str(r["ds"])[:10], "actual": int(r["n_launches"])} for r in rows]


def _ml_forecast_rows() -> list[dict]:
    """Forecast of the MLflow LightGBM model (written by the forecast_mlflow job task)."""
    try:
        rows = run_sql(
            f"SELECT client_id, CAST(ds AS STRING) AS ds, metric_forecast, metric_lower, metric_upper, method, mlflow_run_id, "
            f"CAST(forecast_generated_at AS STRING) AS forecast_generated_at FROM {config.MLFLOW_FORECAST_TABLE} ORDER BY client_id, ds"
        )
    except SqlError as exc:  # missing table or no access: show the ai_forecast chart without the second model
        log.warning("MLflow forecast unavailable: %s", exc)
        return []
    for r in rows:
        for k in ("metric_forecast", "metric_lower", "metric_upper"):
            r[k] = float(r[k]) if r[k] is not None else None
    return rows


def _accuracy_rows() -> dict:
    """Holdout accuracy per method from the latest backtest (forecast_exploration notebook)."""
    try:
        rows = run_sql(
            f"""SELECT method, AVG(mase) AS mase, AVG(mae) AS mae, AVG(coverage) AS coverage, MAX(CAST(evaluated_at AS STRING)) AS evaluated_at
                FROM {config.ACCURACY_TABLE} WHERE fold = 'holdout' GROUP BY method"""
        )
    except SqlError as exc:  # missing table or no access: the chart works without accuracy labels
        log.warning("Forecast accuracy unavailable: %s", exc)
        return {}
    return {r["method"]: {k: (float(r[k]) if r[k] is not None else None) for k in ("mase", "mae", "coverage")}
            | {"evaluated_at": r["evaluated_at"]} for r in rows}


def _forecast_cutoff() -> date:
    """Last complete Monday-week, the same cutoff the forecast tasks use."""
    today = date.today()
    return date.fromordinal(today.toordinal() - today.weekday() - 7)


def _cached(key: str, fn, ttl: int = 120):
    hit = _forecast_cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    val = fn()
    _forecast_cache[key] = (time.time(), val)
    return val


@app.get("/api/forecast")
def forecast(client_id: str | None = None):
    fc, source = _cached("forecast", _forecast_rows)
    ml = _cached("forecast_ml", _ml_forecast_rows)
    weekly = _cached("actuals", _actual_rows)
    accuracy = _cached("accuracy", _accuracy_rows, ttl=600)
    cutoff = _forecast_cutoff().isoformat()
    # History up to the cutoff; weeks after it are announced (scheduled) launches, not actuals
    actuals = [r for r in weekly if r["ds"] <= cutoff]
    scheduled = [{"client_id": r["client_id"], "ds": r["ds"], "scheduled": r["actual"]} for r in weekly if r["ds"] > cutoff]
    clients = sorted({r["client_id"] for r in fc + ml + weekly if r.get("client_id")})
    if client_id:
        fc = [r for r in fc if r["client_id"] == client_id]
        ml = [r for r in ml if r["client_id"] == client_id]
        actuals = [r for r in actuals if r["client_id"] == client_id]
        scheduled = [r for r in scheduled if r["client_id"] == client_id]
    generated = max((str(r["forecast_generated_at"]) for r in fc if r.get("forecast_generated_at")), default=None)
    ml_generated = max((str(r["forecast_generated_at"]) for r in ml if r.get("forecast_generated_at")), default=None)
    return {"clients": clients, "cutoff": cutoff, "actuals": actuals, "scheduled": scheduled,
            "forecast": fc, "source": source, "generated_at": generated,
            "forecast_ml": ml, "ml_generated_at": ml_generated, "ml_run_id": next((r["mlflow_run_id"] for r in ml), None),
            "accuracy": {"ai_forecast": accuracy.get("ai_forecast_current"), "mlflow": accuracy.get("lightgbm_global")}}


# --------------------------------------------------------------------------- utils + static

def _jsonable(row: dict) -> dict:
    out = {}
    for k, v in (row or {}).items():
        if isinstance(v, (date, datetime)):
            out[k] = v.isoformat()
        elif isinstance(v, uuid.UUID):
            out[k] = str(v)
        else:
            out[k] = v
    return out


_DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")
if os.path.isdir(_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(404)
        return FileResponse(os.path.join(_DIST, "index.html"))
else:
    log.warning("Frontend build not found at %s", _DIST)
