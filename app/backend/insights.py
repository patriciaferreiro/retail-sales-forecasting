"""Genie insights: the opening analysis Genie writes for each product and changeover.

Analyses are cached in Lakebase (review.genie_insights) together with the data version they were made from
(latest forecast generated_at / changeover evaluated_at). A newer data version makes them stale.
One background worker asks Genie one question at a time, with exponential backoff on rate limits.
"""
import logging
import queue
import threading
import time
from datetime import date, timedelta

from psycopg.types.json import Jsonb

from . import config
from .db import S, cursor, w
from .warehouse import SqlError, run_sql

log = logging.getLogger(__name__)

SCOPES = ("product", "changeover")
MAX_ROWS = 100
GENIE_TIMEOUT = timedelta(minutes=4)


# --------------------------------------------------------------------------- Genie calls

def message_to_dict(msg) -> dict:
    """Answer text, SQL, result rows and suggested follow-ups of a finished Genie message."""
    out = {"conversation_id": msg.conversation_id, "message_id": msg.message_id,
           "status": msg.status.value if msg.status else None, "text": None, "sql": None, "sql_description": None,
           "columns": [], "rows": [], "row_count": 0, "truncated": False, "suggested_questions": [],
           "error": msg.error.error if getattr(msg, "error", None) else None}
    for a in msg.attachments or []:
        if a.text and a.text.content:
            out["text"] = (out["text"] + "\n\n" if out["text"] else "") + a.text.content
        if a.query:
            out["sql"], out["sql_description"] = a.query.query, a.query.description
            try:
                qr = w.genie.get_message_attachment_query_result(config.GENIE_SPACE_ID, msg.conversation_id, msg.message_id, a.attachment_id)
                sr = qr.statement_response
                rows = (sr.result.data_array or []) if sr and sr.result else []
                out["columns"] = [c.name for c in sr.manifest.schema.columns] if sr and sr.manifest else []
                out["row_count"] = len(rows)
                out["rows"], out["truncated"] = rows[:MAX_ROWS], len(rows) > MAX_ROWS
            except Exception as exc:
                log.warning("Could not fetch the Genie query result: %s", exc)
        sq = getattr(a, "suggested_questions", None)
        if sq and getattr(sq, "questions", None):
            out["suggested_questions"] = list(sq.questions)[:3]
    return out


def _retryable(exc: Exception) -> bool:
    s = str(exc).lower()
    return any(t in s for t in ("429", "rate limit", "too many requests", "resource_exhausted", "409", "already in progress"))


def ask(question: str, conversation_id: str | None = None, attempts: int = 5) -> dict:
    """Ask Genie (new conversation or follow-up); retries with exponential backoff on rate limits."""
    delay = 5.0
    for i in range(attempts):
        try:
            if conversation_id:
                msg = w.genie.create_message_and_wait(config.GENIE_SPACE_ID, conversation_id, question, timeout=GENIE_TIMEOUT)
            else:
                msg = w.genie.start_conversation_and_wait(config.GENIE_SPACE_ID, question, timeout=GENIE_TIMEOUT)
            return message_to_dict(msg)
        except Exception as exc:
            if i == attempts - 1 or not _retryable(exc):
                raise
            log.warning("Genie busy (%s); retrying in %.0fs", exc, delay)
            time.sleep(delay)
            delay = min(delay * 2, 60)


# --------------------------------------------------------------------------- items, versions, questions

_cache: dict = {}


def _cached(key, fn, ttl=60):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    val = fn()
    _cache[key] = (time.time(), val)
    return val


def clear_cache() -> None:
    _cache.clear()


def data_version(scope: str) -> str | None:
    sql = (f"SELECT CAST(MAX(generated_at) AS STRING) AS v FROM {config.SALES_FORECAST_VIEW}" if scope == "product"
           else f"SELECT CAST(MAX(evaluated_at) AS STRING) AS v FROM {config.CHANGEOVER_IMPACT_TABLE}")
    try:
        rows = _cached(("version", scope), lambda: run_sql(sql))
    except SqlError as exc:
        log.warning("No data version for %s: %s", scope, exc)
        return None
    return rows[0]["v"] if rows else None


def items(scope: str) -> dict:
    """key -> attributes used in the question templates."""
    if scope == "product":
        sql = f"""SELECT product_key AS k, MIN(client_id) AS client_id, MIN(article_description) AS article_description,
                         MIN(category) AS category FROM {config.SALES_FORECAST_VIEW} GROUP BY product_key"""
    else:
        sql = f"""SELECT gtin_old AS k, client_id, article_description, category, status, CAST(launch_date AS STRING) AS launch_date
                  FROM {config.CHANGEOVER_IMPACT_TABLE}"""
    try:
        rows = _cached(("items", scope), lambda: run_sql(sql), ttl=300)
    except SqlError as exc:
        log.warning("No %s items: %s", scope, exc)
        return {}
    return {r["k"]: r for r in rows}


def question_for(scope: str, key: str, it: dict) -> str:
    name = f"{it['article_description']} ({it['client_id']}, {it.get('category')})"
    if scope == "product":
        return (f"Give a short analysis of {name}, product_key {key}, for a category manager. Using model mlflow_lightgbm, "
                f"compare its total forecast units for the next 12 weeks with its actual units in the same 12 weeks one year "
                f"earlier (52 weeks before each forecast week) in gold.product_weekly_sales, with the % change; name the peak "
                f"forecast week; give how much the ai_forecast 12-week total differs from mlflow_lightgbm in %; and say whether "
                f"this product has a GTIN changeover in silver.product_launches (date and, if measured, its effect in "
                f"gold.changeover_impact). Answer in at most 4 short sentences and return one summary row.")
    if it.get("status") == "measured":
        return (f"Summarise the GTIN changeover of {name}, gtin_old {key}, switch week {it['launch_date']}: its effect_pct "
                f"on weekly unit sales with the 95% range (ci_low to ci_high), whether it is significant and whether "
                f"controls_fit is true, and how its effect ranks among all measured changeovers in gold.changeover_impact. "
                f"Answer in at most 4 short sentences and return one summary row.")
    measurable = (date.fromisoformat(it["launch_date"]) + timedelta(weeks=15)).isoformat() if it.get("launch_date") else "unknown"
    return (f"{name}, product_key {key}, has a GTIN changeover on {it.get('launch_date')} that is still pending; its effect "
            f"becomes measurable from {measurable}. Give its average weekly units over the last 12 weeks in "
            f"gold.product_weekly_sales and its total forecast units for the next 12 weeks (model mlflow_lightgbm), and "
            f"state the date the effect becomes measurable. Answer in at most 4 short sentences and return one summary row.")


# --------------------------------------------------------------------------- storage

def get(scope: str, key: str) -> dict | None:
    with cursor() as cur:
        cur.execute(f"""SELECT scope, item_key, data_version, question, status, text, sql, columns, rows, suggested,
                               conversation_id, error, updated_at FROM {S}.genie_insights WHERE scope = %s AND item_key = %s""",
                    (scope, key))
        row = cur.fetchone()
    if row:
        row["updated_at"] = row["updated_at"].isoformat() if row["updated_at"] else None
    return row


def _store(scope, key, version, question, status, ans=None, error=None):
    ans = ans or {}
    with cursor() as cur:
        cur.execute(
            f"""INSERT INTO {S}.genie_insights (scope, item_key, data_version, question, status, text, sql, columns, rows,
                                                suggested, conversation_id, error, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                ON CONFLICT (scope, item_key) DO UPDATE SET data_version = EXCLUDED.data_version, question = EXCLUDED.question,
                  status = EXCLUDED.status, text = EXCLUDED.text, sql = EXCLUDED.sql, columns = EXCLUDED.columns,
                  rows = EXCLUDED.rows, suggested = EXCLUDED.suggested, conversation_id = EXCLUDED.conversation_id,
                  error = EXCLUDED.error, updated_at = now()""",
            (scope, key, version, question, status, ans.get("text"), ans.get("sql"), Jsonb(ans.get("columns") or []),
             Jsonb(ans.get("rows") or []), Jsonb(ans.get("suggested_questions") or []), ans.get("conversation_id"), error),
        )


def is_current(row: dict | None, version: str | None) -> bool:
    return bool(row) and row["status"] == "ready" and version is not None and row["data_version"] == version


# --------------------------------------------------------------------------- background worker

_q: "queue.Queue[tuple[str, str]]" = queue.Queue()
_pending: set = set()
_lock = threading.Lock()
_worker: threading.Thread | None = None


def generate_one(scope: str, key: str) -> None:
    it = items(scope).get(key)
    if not it:
        return
    version, question = data_version(scope), question_for(scope, key, it)
    prev = get(scope, key)
    if prev:  # keep the previous answer visible while regenerating
        with cursor() as cur:
            cur.execute(f"UPDATE {S}.genie_insights SET status = 'generating', updated_at = now() WHERE scope = %s AND item_key = %s", (scope, key))
    else:
        _store(scope, key, version, question, "generating")
    try:
        ans = ask(question)
        if ans["status"] == "COMPLETED":
            _store(scope, key, version, question, "ready", ans)
        else:
            _store(scope, key, version, question, "failed", ans, error=ans.get("error") or f"Genie status {ans['status']}")
    except Exception as exc:
        log.exception("Genie insight %s/%s failed", scope, key)
        _store(scope, key, version, question, "failed", error=str(exc)[:500])


def _run():
    while True:
        scope, key = _q.get()
        try:
            generate_one(scope, key)
        except Exception:
            log.exception("Insight worker error")
        finally:
            with _lock:
                _pending.discard((scope, key))
            _q.task_done()


def enqueue(scope: str, key: str) -> bool:
    """Queue one item; False if it is already queued. Starts the single worker on first use."""
    global _worker
    with _lock:
        if (scope, key) in _pending:
            return False
        _pending.add((scope, key))
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run, name="genie-insights", daemon=True)
            _worker.start()
    _q.put((scope, key))
    return True


def is_pending(scope: str, key: str) -> bool:
    with _lock:
        return (scope, key) in _pending


def prewarm_all() -> dict:
    """Queue every product and changeover whose analysis is missing or stale."""
    if not config.GENIE_SPACE_ID:
        return {"queued": 0, "current": 0}
    clear_cache()
    queued = current = 0
    for scope in SCOPES:
        version = data_version(scope)
        for key in sorted(items(scope)):
            if is_current(get(scope, key), version):
                current += 1
            elif enqueue(scope, key):
                queued += 1
    log.info("Genie insights: %d queued, %d already current", queued, current)
    return {"queued": queued, "current": current}


def prewarm_in_background() -> None:
    threading.Thread(target=lambda: _safe(prewarm_all), name="genie-prewarm", daemon=True).start()


def _safe(fn):
    try:
        fn()
    except Exception:
        log.exception("Genie prewarm failed")
