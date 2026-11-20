"""Validation rules for extracted product rows.

Each issue is {"field", "message", "severity"}; severity "error" blocks approval,
"warning" is shown but does not block.
"""
import re
from datetime import date, datetime

GTIN_LENGTHS = {8, 12, 13, 14}
NUMERIC_ID_TYPES = {"GTIN", "EAN", "UPC", "GTIN-8", "GTIN-12", "GTIN-13", "GTIN-14", "EAN-8", "EAN-13"}
_DATE_FORMATS = ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d.%m.%y")


def gtin_check_digit_ok(code: str) -> bool:
    """GS1 mod-10 check: weights 3,1,3,... from the rightmost digit excluding the check digit."""
    if not code.isdigit() or len(code) not in GTIN_LENGTHS:
        return False
    body, check = code[:-1], int(code[-1])
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - total % 10) % 10 == check


def normalize_identifier(value: str | None) -> str | None:
    if value is None:
        return None
    v = re.sub(r"[\s\-]", "", str(value))
    return v or None


def parse_date(value) -> date | None:
    """Parse ISO or common European date strings; return None if unparseable."""
    if value in (None, ""):
        return None
    if isinstance(value, date):
        return value
    s = str(value).strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _is_numeric_type(id_type: str | None, code: str | None) -> bool:
    t = (id_type or "").strip().upper()
    if t in NUMERIC_ID_TYPES:
        return True
    # Unknown/blank type but looks like a GTIN: still check it
    return not t and bool(code) and code.isdigit() and len(code) in GTIN_LENGTHS


def validate(row: dict, *, published_keys: set, duplicate_in_review: bool, today: date | None = None) -> list[dict]:
    today = today or date.today()
    issues: list[dict] = []

    def add(field, message, severity="error"):
        issues.append({"field": field, "message": message, "severity": severity})

    for field, label in (("client_id", "Client"), ("article_description", "Description"), ("identifier_new", "New identifier")):
        if not (row.get(field) or "").strip():
            add(field, f"{label} is required")

    ld = row.get("launch_date")
    if ld is None:
        raw = row.get("launch_date_raw")
        add("launch_date", f"Launch date could not be parsed from '{raw}'" if raw else "Launch date is required")
    elif ld < today:
        add("launch_date", "Launch date is in the past", "warning")

    for field in ("identifier_new", "identifier_old"):
        code = row.get(field)
        if code and _is_numeric_type(row.get("identifier_type"), code):
            if not code.isdigit():
                add(field, "Identifier must contain digits only")
            elif len(code) not in GTIN_LENGTHS:
                add(field, f"Invalid length {len(code)}; GTIN/EAN must have 8, 12, 13 or 14 digits")
            elif not gtin_check_digit_ok(code):
                add(field, "Check digit is invalid")

    if row.get("identifier_old") and row.get("identifier_old") == row.get("identifier_new"):
        add("identifier_old", "Old and new identifier are identical", "warning")

    key = ((row.get("client_id") or "").strip().lower(), row.get("identifier_new"))
    if key[0] and key[1] and key in published_keys:
        add("identifier_new", "Already published for this client")
    if duplicate_in_review:
        add("identifier_new", "Same client and identifier exists in another upload", "warning")

    return issues


def has_errors(issues: list[dict]) -> bool:
    return any(i["severity"] == "error" for i in issues)
