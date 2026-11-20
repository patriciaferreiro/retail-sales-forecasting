"""Single-file extraction: same ai_parse_document + ai_extract logic as
src/extraction/extract_product_data, scoped to one uploaded file."""
import re

from .warehouse import run_sql

# Kept identical to src/extraction/extract_product_data so the app and the daily job agree.
EXTRACT_SCHEMA = """{
  "client_name": {"type": "string", "description": "Name of the brand or client"},
  "launch_date": {"type": "string", "description": "Cutover/launch date in YYYY-MM-DD format. Look for dates, KWLT (Kalenderwoche Liefertermin), or similar"},
  "products": {
    "type": "array",
    "description": "All products listed in the document",
    "items": {
      "type": "object",
      "properties": {
        "article_description": {"type": "string", "description": "Full product name/description"},
        "identifier_old": {"type": "string", "description": "Previous/old identifier (GTIN ALT, old SKU, old EAN)"},
        "identifier_new": {"type": "string", "description": "New identifier (GTIN NEU, new SKU, new EAN)"},
        "identifier_type": {"type": "string", "description": "Type of identifier: GTIN, EAN, SKU, UPC, etc."},
        "size": {"type": "string", "description": "Product size or volume"},
        "packaging": {"type": "string", "description": "Packaging type (Dose, Tube, Flasche, etc.)"},
        "category": {"type": "string", "description": "Product category"}
      }
    }
  },
  "notes": {"type": "string", "description": "Any additional instructions or context from the document"}
}"""

EXTRACT_INSTRUCTIONS = (
    "Extract product launch/changeover information. Documents may be in German or other languages. "
    "They often describe GTIN changes, new product introductions, or identifier transitions. "
    "Extract ALL products listed. Dates may be in DD.MM.YYYY or other European formats — normalize to YYYY-MM-DD."
)

_SAFE_PATH = re.compile(r"^/Volumes/[A-Za-z0-9_\-]+/[A-Za-z0-9_\-]+/[A-Za-z0-9_\-]+/[A-Za-z0-9_\-./]+$")


def _field(obj: str, name: str) -> str:
    """ai_extract v2.1 returns each field as {"value": ...} (value may be null); accept plain values too."""
    return (
        f"CASE WHEN schema_of_variant({obj}:{name}) LIKE 'OBJECT%' "
        f"THEN {obj}:{name}:value::STRING ELSE {obj}:{name}::STRING END"
    )


def _sql_str(s: str) -> str:
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


# Text of all parsed elements (ai_parse_document v2.0: document.elements[].content)
_DOC_TEXT_SQL = "concat_ws('\\n', transform(TRY_CAST(parsed:document:elements AS ARRAY<VARIANT>), el -> el:content::STRING))"


def clean_parsed_text(text: str | None) -> str | None:
    """Turn the parser's HTML tables into readable lines: cells joined by ' | ', one row per line."""
    if not text:
        return None
    t = re.sub(r"</t[dh]>\s*<t[dh][^>]*>", " | ", text)
    t = re.sub(r"</tr>\s*", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ")
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip() or None


def parse_text(volume_path: str) -> str | None:
    """Parse a file and return only its readable text (used to backfill older uploads)."""
    if not _SAFE_PATH.match(volume_path) or ".." in volume_path:
        raise ValueError(f"Unsafe volume path: {volume_path}")
    rows = run_sql(f"""
    WITH p AS (
      SELECT ai_parse_document(content, MAP('version', '2.0')) AS parsed
      FROM READ_FILES({_sql_str(volume_path)}, format => 'binaryFile')
    )
    SELECT {_DOC_TEXT_SQL} AS parsed_text FROM p
    """)
    return clean_parsed_text(rows[0]["parsed_text"]) if rows else None


def extract_file(volume_path: str) -> dict:
    """Parse and extract one file. Returns {source_file, parse_error, rows}.

    rows are dicts with client_id, launch_date_raw, notes and the product fields.
    """
    if not _SAFE_PATH.match(volume_path) or ".." in volume_path:
        raise ValueError(f"Unsafe volume path: {volume_path}")

    sql = f"""
    WITH f AS (
      SELECT _metadata.file_path AS source_file, content
      FROM READ_FILES({_sql_str(volume_path)}, format => 'binaryFile')
    ),
    p AS (
      SELECT source_file, ai_parse_document(content, MAP('version', '2.0')) AS parsed FROM f
    ),
    e AS (
      SELECT
        source_file,
        CAST(parsed:error_status AS STRING) AS parse_error,
        {_DOC_TEXT_SQL} AS parsed_text,
        CASE WHEN is_variant_null(parsed:error_status) THEN
          ai_extract(parsed, {_sql_str(EXTRACT_SCHEMA)},
                     MAP('version', '2.1', 'instructions', {_sql_str(EXTRACT_INSTRUCTIONS)}))
        END AS extracted
      FROM p
    ),
    r AS (
      -- ai_extract v2.1 wraps the result in {{response: ..., error_message, metadata}}
      SELECT source_file, parse_error, parsed_text, CAST(extracted:error_message AS STRING) AS extract_error,
             COALESCE(extracted:response, extracted) AS x
      FROM e
    )
    SELECT
      source_file,
      parse_error,
      extract_error,
      -- document text only on the first row, so it isn't repeated per product
      CASE WHEN COALESCE(pos, 0) = 0 THEN parsed_text END AS parsed_text,
      {_field('x', 'client_name')} AS client_id,
      {_field('x', 'launch_date')} AS launch_date_raw,
      {_field('x', 'notes')} AS notes,
      {_field('product', 'article_description')} AS article_description,
      {_field('product', 'identifier_old')} AS identifier_old,
      {_field('product', 'identifier_new')} AS identifier_new,
      {_field('product', 'identifier_type')} AS identifier_type,
      {_field('product', 'size')} AS size,
      {_field('product', 'packaging')} AS packaging,
      {_field('product', 'category')} AS category
    FROM r
    LATERAL VIEW OUTER POSEXPLODE(TRY_CAST(x:products AS ARRAY<VARIANT>)) AS pos, product
    """
    rows = run_sql(sql)
    if not rows:
        return {"source_file": None, "parse_error": "File not found or empty", "parsed_text": None, "rows": []}
    first = rows[0]
    products = [r for r in rows if r.get("article_description")]
    return {
        "source_file": first["source_file"],
        "parse_error": first.get("parse_error"),
        "extract_error": first.get("extract_error"),
        "parsed_text": clean_parsed_text(next((r["parsed_text"] for r in rows if r.get("parsed_text")), None)),
        "rows": products,
    }
