"""SQL warehouse access through the Statement Execution API (runs as the app service principal)."""
import time
from typing import Any

from databricks.sdk.service.sql import (
    ExecuteStatementRequestOnWaitTimeout,
    StatementParameterListItem,
    StatementState,
)

from .config import WAREHOUSE_ID
from .db import w

_TERMINAL = {StatementState.SUCCEEDED, StatementState.FAILED, StatementState.CANCELED, StatementState.CLOSED}


class SqlError(RuntimeError):
    pass


def _param(name: str, value: Any) -> StatementParameterListItem:
    if value is None:
        return StatementParameterListItem(name=name, value=None, type="STRING")
    return StatementParameterListItem(name=name, value=str(value), type="STRING")


def run_sql(statement: str, params: dict | None = None, timeout_s: int = 900) -> list[dict]:
    """Run a statement and return rows as dicts (all values as strings or None)."""
    resp = w.statement_execution.execute_statement(
        warehouse_id=WAREHOUSE_ID,
        statement=statement,
        parameters=[_param(k, v) for k, v in (params or {}).items()] or None,
        wait_timeout="30s",
        on_wait_timeout=ExecuteStatementRequestOnWaitTimeout.CONTINUE,
    )
    deadline = time.time() + timeout_s
    while resp.status.state not in _TERMINAL:
        if time.time() > deadline:
            w.statement_execution.cancel_execution(resp.statement_id)
            raise SqlError("SQL statement timed out")
        time.sleep(2)
        resp = w.statement_execution.get_statement(resp.statement_id)

    if resp.status.state != StatementState.SUCCEEDED:
        err = resp.status.error.message if resp.status.error else resp.status.state.value
        raise SqlError(err)

    if not resp.manifest or not resp.manifest.schema or not resp.manifest.schema.columns:
        return []
    cols = [c.name for c in resp.manifest.schema.columns]
    rows: list[list] = []
    result = resp.result
    while result is not None:
        rows.extend(result.data_array or [])
        if result.next_chunk_index is None:
            break
        result = w.statement_execution.get_statement_result_chunk_n(resp.statement_id, result.next_chunk_index)
    return [dict(zip(cols, r)) for r in rows]
