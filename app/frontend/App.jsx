import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "./api.js";

// Grid columns. Description comes first so it can be pinned with the checkbox and status columns.
// w = cell width in px (inputs fill the cell); hideable columns can be toggled in the Columns menu.
const COLUMNS = [
  { key: "article_description", label: "Description", w: 240, pin: "pin-3 pin-last" },
  { key: "client_id", label: "Client", w: 110 },
  { key: "launch_date", label: "Launch date", w: 140, type: "date" },
  { key: "identifier_old", label: "Old ID", w: 130 },
  { key: "identifier_new", label: "New ID", w: 130 },
  { key: "identifier_type", label: "ID type", w: 75 },
  { key: "size", label: "Size", w: 80, hideable: true },
  { key: "packaging", label: "Packaging", w: 100, hideable: true },
  { key: "category", label: "Category", w: 120, hideable: true },
  { key: "notes", label: "Notes", w: 180, hideable: true },
];
const ACTIVE_RUN = ["QUEUED", "PENDING", "RUNNING", "BLOCKED", "WAITING_FOR_RETRY", "TERMINATING"];

function usePolling(fn, ms, enabled = true) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!enabled) return undefined;
    saved.current();
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
}

const fmtTime = (t) => (t ? new Date(t).toLocaleString() : "");

// State that survives reloads (per browser)
function useStoredState(key, initial) {
  const [value, setValue] = useState(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } }, [key, value]);
  return [value, setValue];
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    onChange();
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

// Vendor = the products' Client field; compared ignoring case and surrounding spaces
const normVendor = (s) => (s || "").trim().toLowerCase();

const HIDEABLE = [
  ...COLUMNS.filter((c) => c.hideable).map((c) => ({ key: c.key, label: c.label })),
  { key: "updated_at", label: "Last edit" },
];

// ------------------------------------------------------------------ toasts
function Toasts({ items, onClose }) {
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => onClose(t.id)}>{t.text}</div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ uploads
function UploadPanel({ selected, onSelect, notify, collapsed = false, onToggleCollapse, vendor = "", onVendor }) {
  const [uploads, setUploads] = useState([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    try { setUploads((await api.uploads()).uploads); } catch (e) { notify(e.message, "error"); }
  }, [notify]);
  const anyRunning = uploads.some((u) => u.status === "uploaded" || u.status === "extracting");
  usePolling(load, anyRunning ? 3000 : 10000);

  async function send(files) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const res = await api.upload(files);
      notify(`Uploaded ${res.uploads.length} file(s); extraction started`, "ok");
      if (res.uploads[0]) onSelect(res.uploads[0].upload_id);
      await load();
    } catch (e) {
      notify(`Upload failed: ${e.message}`, "error");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const pick = (id) => onSelect(id);
  const current = uploads.find((u) => u.upload_id === selected);
  const openPicker = () => inputRef.current?.click();
  const dropHandlers = {
    onDragOver: (e) => { e.preventDefault(); setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop: (e) => { e.preventDefault(); setDrag(false); send(e.dataTransfer.files); },
  };

  // Vendors across all uploads (case-insensitive), with how many uploads include each
  const vKey = normVendor(vendor);
  const vendors = useMemo(() => {
    const m = new Map();
    for (const u of uploads) {
      for (const k of new Set((u.vendors || []).map(normVendor))) {
        if (!k) continue;
        const label = (u.vendors || []).find((v) => normVendor(v) === k).trim();
        const e = m.get(k) || { key: k, label, count: 0 };
        e.count += 1;
        m.set(k, e);
      }
    }
    if (vKey && !m.has(vKey)) m.set(vKey, { key: vKey, label: vendor.trim(), count: 0 }); // keep a remembered choice visible
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [uploads, vKey, vendor]);
  const inProgress = (u) => u.status === "uploaded" || u.status === "extracting";
  // With a vendor selected: uploads with a product from that vendor, plus uploads still being extracted
  // (so a fresh upload never disappears); finished uploads without products are hidden and counted
  const filtered = vKey
    ? uploads.filter((u) => inProgress(u) || (u.vendors || []).some((v) => normVendor(v) === vKey))
    : uploads;
  const hiddenNoProducts = vKey ? uploads.filter((u) => !inProgress(u) && !(u.vendors || []).length).length : 0;

  const fileInput = (
    <input ref={inputRef} type="file" multiple hidden accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.tif,.tiff"
           onChange={(e) => send(e.target.files)} />
  );
  const vendorSelect = (
    <select className="vendor-select" value={vKey ? (vendors.find((v) => v.key === vKey)?.label ?? "") : ""}
            onChange={(e) => onVendor?.(e.target.value)} title="Filter uploads and products by vendor (Client)">
      <option value="">All vendors ({uploads.length})</option>
      {vendors.map((v) => <option key={v.key} value={v.label}>{v.label} ({v.count})</option>)}
    </select>
  );
  const filterNotes = (
    <>
      {vKey && hiddenNoProducts > 0 && (
        <div className="muted note">
          {hiddenNoProducts} upload(s) without products hidden ·{" "}
          <button className="link" onClick={() => onVendor?.("")}>Show all vendors</button>
        </div>
      )}
    </>
  );

  const list = (
    <>
      <ul className="upload-list">
        {filtered.map((u) => (
          <li key={u.upload_id} className={u.upload_id === selected ? "active" : ""} onClick={() => pick(u.upload_id)}>
            <div className="row1">
              <span className="fname" title={u.file_name}>{u.file_name}</span>
              <span className={`badge ${u.status}`}>{u.status}</span>
            </div>
            {(u.vendors || []).length > 0 && (
              <div className="chips">{u.vendors.map((v) => <span key={v} className="chip">{v}</span>)}</div>
            )}
            <div className="row2">
              {u.total > 0
                ? <>{u.pending} pending · {u.approved} approved · {u.published} published{u.rejected ? ` · ${u.rejected} rejected` : ""}</>
                : u.status === "failed" ? <span className="err" title={u.error}>{u.error}</span> : "…"}
            </div>
            <div className="row3">{u.uploaded_by} · {fmtTime(u.uploaded_at)}</div>
            {u.status === "failed" && (
              <button className="link" onClick={async (e) => {
                e.stopPropagation();
                try { await api.retry(u.upload_id); load(); } catch (err) { notify(err.message, "error"); }
              }}>Retry extraction</button>
            )}
          </li>
        ))}
        {!uploads.length && <li className="empty">No uploads yet. Upload a launch document to start.</li>}
        {uploads.length > 0 && !filtered.length && <li className="empty">No uploads for this vendor</li>}
      </ul>
    </>
  );

  if (!collapsed) {
    return (
      <div className="panel uploads">
        {fileInput}
        <div className="uploads-head">
          <h2>Documents</h2>
          <button className="icon-btn" title="Collapse the upload history" aria-label="Collapse the upload history" onClick={onToggleCollapse}>«</button>
        </div>
        <section className="up-sec">
          <h3><span className="step">1</span> Upload a new file</h3>
          <div className={`dropzone ${drag ? "drag" : ""}`} {...dropHandlers} onClick={openPicker}>
            <div>Drag &amp; drop launch documents here</div>
            <button className="primary" disabled={busy} onClick={(e) => { e.stopPropagation(); openPicker(); }}>
              {busy ? "Uploading…" : "Upload file"}
            </button>
            <small>PDF, DOCX or images · up to 50 MB</small>
          </div>
        </section>
        <section className="up-sec">
          <h3><span className="step">2</span> Filter by vendor</h3>
          {vendorSelect}
        </section>
        <section className="up-sec grow">
          <h3>
            <span className="step">3</span> Review past uploads
            <span className="muted count">{filtered.length} of {uploads.length}</span>
          </h3>
          {filterNotes}
          {list}
        </section>
      </div>
    );
  }

  // Collapsed: a thin strip on the left (expand + upload); the grid takes the freed width
  return (
    <div className={`panel uploads rail ${drag ? "drag" : ""}`} {...dropHandlers}
         title={current ? `Current file: ${current.file_name}` : "Documents"}>
      {fileInput}
      <button className="rail-btn" title="Show Documents (upload, vendor filter, past uploads)"
              aria-label="Show Documents" onClick={onToggleCollapse}>»</button>
      <button className="rail-btn primary" disabled={busy} onClick={openPicker}
              title="Upload a new file (or drop it on this strip)" aria-label="Upload a new file">{busy ? "…" : "+"}</button>
      {vKey && (
        <span className="rail-vendor" title={`Vendor filter: ${vendor.trim()} (click to show Documents)`} onClick={onToggleCollapse}>
          {vendor.trim()}
        </span>
      )}
      <span className="rail-label" onClick={onToggleCollapse}>Documents</span>
    </div>
  );
}

// ------------------------------------------------------------------ review grid
function Cell({ row, col, issues, onSave, setEditing }) {
  const original = row[col.key] ?? "";
  const [value, setValue] = useState(original);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setValue(original); }, [original, row.version]);

  const fieldIssues = issues.filter((i) => i.field === col.key);
  const level = fieldIssues.some((i) => i.severity === "error") ? "error" : fieldIssues.length ? "warning" : "";
  const disabled = row.status === "published";

  const commit = () => {
    focused.current = false;
    setEditing(false);
    if (String(value) !== String(original)) onSave(row, { [col.key]: value });
  };
  const issueText = fieldIssues.map((i) => i.message).join("\n");
  return (
    <td className={`${level} ${col.pin ? `pin ${col.pin}` : ""}`} style={{ width: col.w, minWidth: col.w, maxWidth: col.w }}>
      <input
        type={col.type === "date" ? "date" : "text"}
        value={value ?? ""}
        disabled={disabled}
        title={issueText || (value ? String(value) : "")}
        onFocus={() => { focused.current = true; setEditing(true); }}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setValue(original); focused.current = false; e.currentTarget.blur(); }
        }}
      />
    </td>
  );
}

// ------------------------------------------------------------------ product detail panel
const LABELS = Object.fromEntries(COLUMNS.map((c) => [c.key, c.label]));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Regex matching a value with any spacing/punctuation between its characters (e.g. "200ml" ~ "200 ml")
function looseRegex(value) {
  const chars = String(value).replace(/[\s\-_.,;:/|]+/g, "").split("");
  if (!chars.length) return null;
  return new RegExp(chars.map(escapeRe).join("[\\s\\-_.,;:/|]*"), "gi");
}

function dateVariants(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? [iso, `${m[3]}.${m[2]}.${m[1]}`, `${m[3]}/${m[2]}/${m[1]}`] : [iso];
}

function HighlightedText({ text, terms }) {
  const ref = useRef(null);
  const parts = useMemo(() => {
    const regs = terms.filter(Boolean).map(looseRegex).filter(Boolean);
    if (!regs.length) return [text];
    const big = new RegExp(regs.map((r) => r.source).join("|"), "gi");
    const out = []; let last = 0; let m;
    while ((m = big.exec(text)) !== null) {
      if (m[0] === "") { big.lastIndex++; continue; }
      out.push(text.slice(last, m.index), <mark key={m.index}>{m[0]}</mark>);
      last = m.index + m[0].length;
    }
    out.push(text.slice(last));
    return out;
  }, [text, terms]);
  useEffect(() => { ref.current?.querySelector("mark")?.scrollIntoView({ block: "center" }); }, [parts]);
  return <pre ref={ref} className="doc-text">{parts}</pre>;
}

function FieldRow({ f, version, onSave, selected, onSelect, extra }) {
  const [value, setValue] = useState(f.current ?? "");
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setValue(f.current ?? ""); }, [f.current, version]);
  const commit = () => {
    focused.current = false;
    if (String(value) !== String(f.current ?? "")) onSave({ [f.field]: value });
  };
  const found = f.found_in_document;
  return (
    <tr className={`chk-${f.status} ${selected ? "sel" : ""}`} onClick={() => onSelect(f)}>
      <td className="fname-cell">{LABELS[f.field] || f.field}</td>
      <td className={f.extracted == null ? "missing" : ""}>{f.extracted ?? "(not found)"}</td>
      <td>
        <input
          type={f.field === "launch_date" ? "date" : "text"}
          value={value ?? ""}
          onFocus={() => { focused.current = true; onSelect(f); }}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          className={f.edited ? "edited" : ""}
        />
      </td>
      <td>
        {found === true && <span className="found yes" title="Value occurs in the document text">in doc</span>}
        {found === false && <span className="found no" title="Value not found in the document text">not in doc</span>}
      </td>
      <td>
        {f.status === "ok" ? <span className="ok">ok</span>
          : f.issues.map((i, n) => <div key={n} className={i.severity}>{i.message}</div>)}
        {extra}
      </td>
    </tr>
  );
}

function ProductPanel({ productId, onClose, onNavigate, onChanged, notify, renderFieldExtra, header }) {
  const [d, setD] = useState(null);
  const [text, setText] = useState(null);
  const [view, setView] = useState("preview");
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setD(await api.detail(productId)); } catch (e) { notify(e.message, "error"); }
  }, [productId, notify]);
  useEffect(() => { setD(null); setSel(null); load(); }, [productId]); // eslint-disable-line
  useEffect(() => {
    if (!d) return;
    api.text(d.product.upload_id).then((r) => setText(r.text)).catch(() => setText(null));
  }, [d?.product.upload_id]); // eslint-disable-line
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT") return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown" && d?.next_id) onNavigate(d.next_id);
      if (e.key === "ArrowUp" && d?.prev_id) onNavigate(d.prev_id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [d, onClose, onNavigate]);

  async function save(changes) {
    try {
      await api.patch(productId, d.product.version, changes);
      await load(); onChanged?.();
    } catch (e) {
      if (e.status === 409) { notify(`${e.detail?.message || "Changed by someone else"}. Reloaded.`, "warn"); await load(); }
      else notify(`Save failed: ${e.message}`, "error");
    }
  }
  async function setStatus(status) {
    setBusy(true);
    try {
      const r = await api.setStatus(status, [{ product_id: productId, version: d.product.version }]);
      if (r.blocked.length) notify("Fix the errors before approving", "warn");
      else if (r.conflicts.length) notify("Changed by someone else. Reloaded.", "warn");
      else notify(`Product ${status}`, "ok");
      await load(); onChanged?.();
    } catch (e) { notify(e.message, "error"); } finally { setBusy(false); }
  }

  const terms = useMemo(() => (
    sel ? (sel.field === "launch_date" ? dateVariants(sel.current).concat(sel.extracted) : [sel.current, sel.extracted]) : []
  ), [sel?.field, sel?.current, sel?.extracted]); // eslint-disable-line
  const select = (f) => { setSel(f); if (text) setView("text"); };
  const errors = d ? d.fields.filter((f) => f.status === "error").length : 0;
  const notFound = d ? d.fields.filter((f) => f.found_in_document === false).length : 0;

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="side-panel" onClick={(e) => e.stopPropagation()}>
        {!d ? <div className="empty-state">Loading…</div> : (
          <>
            <div className="sp-head">
              <div>
                <div className="sp-title">{d.product.article_description || "(no description)"}</div>
                <div className="muted">
                  <span className={`badge ${d.product.status}`}>{d.product.status}</span>{" "}
                  {d.upload.file_name} · product {d.position} of {d.total} · last edit {d.product.updated_by}
                </div>
              </div>
              <span className="spacer" />
              {header?.(d, load)}
              <button disabled={!d.prev_id} onClick={() => onNavigate(d.prev_id)} title="Previous (↑)">← Prev</button>
              <button disabled={!d.next_id} onClick={() => onNavigate(d.next_id)} title="Next (↓)">Next →</button>
              <button disabled={busy || d.product.status === "published"} onClick={() => setStatus("rejected")}>Reject</button>
              <button className="primary" disabled={busy || errors > 0 || ["published", "approved"].includes(d.product.status)}
                      title={errors ? "Fix the errors first" : ""} onClick={() => setStatus("approved")}>Approve</button>
              <button onClick={onClose} title="Close (Esc)">✕</button>
            </div>
            <div className="sp-body">
              <div className="sp-doc">
                <div className="sp-tabs">
                  <button className={view === "preview" ? "on" : ""} onClick={() => setView("preview")}>Preview</button>
                  <button className={view === "text" ? "on" : ""} disabled={!text} onClick={() => setView("text")}>Document text</button>
                  {sel && <span className="muted">highlighting {LABELS[sel.field]}</span>}
                </div>
                <div className="sp-doc-body">
                  {view === "text" && text ? <HighlightedText text={text} terms={terms} />
                    : d.upload.preview === "pdf" ? <iframe className="doc-frame" title="document" src={api.fileUrl(d.product.upload_id)} />
                    : d.upload.preview === "image" ? <div className="doc-image"><img src={api.fileUrl(d.product.upload_id)} alt="document" /></div>
                    : <div className="empty-state"><a href={api.fileUrl(d.product.upload_id)} download>Download {d.upload.file_name}</a></div>}
                </div>
              </div>
              <div className="sp-fields">
                <div className="muted sp-summary">
                  {errors} error(s) · {notFound} value(s) not found in the document · click a field to highlight it in the text
                </div>
                <table className="field-table">
                  <thead><tr><th>Field</th><th>Extracted</th><th>Current</th><th>Source</th><th>Check</th></tr></thead>
                  <tbody>
                    {d.fields.map((f) => (
                      <FieldRow key={f.field} f={f} version={d.product.version} onSave={save}
                                selected={sel?.field === f.field} onSelect={select}
                                extra={renderFieldExtra?.(d, f, load, select)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ AI suggestions
function SuggestionCard({ s, stale, onApply, onDismiss, onShowEvidence, busy }) {
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <div className={`ai-card ${s.still_invalid ? "bad" : ""}`} onClick={(e) => e.stopPropagation()}>
      <div className="ai-card-head">
        <span className="ai-tag">AI</span>
        {s.action === "change" && <span>Suggested: <b>{s.suggested_value}</b></span>}
        {s.action === "clear" && <span>Suggested: <b>clear the value</b></span>}
        {s.action === "no_change" && <span><b>No change suggested</b></span>}
        <span className={`conf conf-${s.confidence}`}>{s.confidence} confidence</span>
      </div>
      {s.reason && <div className="ai-reason">{s.reason}</div>}
      {s.evidence_quote && (
        <div className="ai-evidence">
          “{s.evidence_quote}”{" "}
          {s.evidence_found
            ? <button className="link" onClick={stop(onShowEvidence)}>Show in document</button>
            : <span className="warn-text">quote not found in the document text</span>}
        </div>
      )}
      {s.still_invalid && (
        <div className="warn-text">Would still fail: {(s.validation_messages || []).map((m) => m.message).join("; ")}</div>
      )}
      {s.action === "change" && s.value_in_document === false && (
        <div className="warn-text">This value doesn't appear in the document. Confirm it with the client.</div>
      )}
      {stale && <div className="muted">Based on an older version of this product.</div>}
      <div className="ai-actions">
        <button className="primary" disabled={busy || s.action === "no_change"} onClick={stop(onApply)}>Apply</button>
        <button disabled={busy} onClick={stop(onDismiss)}>Dismiss</button>
      </div>
    </div>
  );
}

function AiProductPanel(props) {
  const { productId, notify, onChanged } = props;
  const [sugs, setSugs] = useState([]);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(null); // field name, "__all", or "__decide"

  const loadSugs = useCallback(async () => {
    try { setSugs((await api.suggestions(productId)).suggestions); } catch { /* panel still works */ }
  }, [productId]);
  useEffect(() => { setSugs([]); setNote(null); loadSugs(); }, [productId]); // eslint-disable-line

  async function ask(field) {
    setBusy(field ?? "__all");
    try {
      const r = await api.suggest(productId, field);
      setNote(r.product_note || null);
      if (!r.suggestions.length) notify("The AI returned no suggestion for this field", "warn");
      await loadSugs();
    } catch (e) { notify(`AI suggestion failed: ${e.message}`, "error"); } finally { setBusy(null); }
  }
  async function apply(s, d, reload) {
    setBusy("__decide");
    try {
      await api.applySuggestion(s.suggestion_id, d.product.version);
      notify(`Applied AI suggestion to ${LABELS[s.field] || s.field}`, "ok");
      await reload(); await loadSugs(); onChanged?.();
    } catch (e) {
      notify(e.status === 409 ? `${e.detail?.message || e.message}. Reloaded.` : `Apply failed: ${e.message}`, e.status === 409 ? "warn" : "error");
      await reload(); await loadSugs();
    } finally { setBusy(null); }
  }
  async function dismiss(s) {
    setBusy("__decide");
    try { await api.dismissSuggestion(s.suggestion_id); await loadSugs(); }
    catch (e) { notify(e.message, "error"); } finally { setBusy(null); }
  }

  const header = (d) => {
    const errs = d.fields.filter((f) => f.status === "error").length;
    return (
      <>
        {note && <span className="ai-note" title={note}>AI: {note}</span>}
        {errs > 0 && d.product.status !== "published" && (
          <button className="ai-btn" disabled={!!busy} onClick={() => ask(null)}>
            {busy === "__all" ? "Asking AI…" : `Suggest fixes (${errs})`}
          </button>
        )}
      </>
    );
  };
  const extra = (d, f, reload, select) => {
    const mine = sugs.filter((s) => s.field === f.field);
    return (
      <>
        {f.status === "error" && d.product.status !== "published" && (
          <div>
            <button className="ai-btn small" disabled={!!busy} onClick={(e) => { e.stopPropagation(); ask(f.field); }}>
              {busy === f.field ? "Asking AI…" : "AI suggestion"}
            </button>
          </div>
        )}
        {mine.map((s) => (
          <SuggestionCard key={s.suggestion_id} s={s} busy={!!busy} stale={s.based_on_version !== d.product.version}
                          onApply={() => apply(s, d, reload)} onDismiss={() => dismiss(s)}
                          onShowEvidence={() => select({ field: f.field, current: s.evidence_quote, extracted: null })} />
        ))}
      </>
    );
  };
  return <ProductPanel {...props} header={header} renderFieldExtra={extra} />;
}

function ReviewGrid({ uploadId, notify, vendor = "", onClearVendor }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [hidden, setHidden] = useStoredState("plf.grid.hiddenColumns", []);
  const [density, setDensity] = useStoredState("plf.grid.density", "comfortable");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const tableRef = useRef(null);
  const editing = useRef(false);
  const setEditing = (v) => { editing.current = v; };

  const load = useCallback(async (force = false) => {
    if (!uploadId || (editing.current && !force)) return;
    try { setRows((await api.products(uploadId)).products); } catch (e) { notify(e.message, "error"); }
  }, [uploadId, notify]);

  useEffect(() => { setRows([]); setSelected(new Set()); setLoading(true); load(true).finally(() => setLoading(false)); }, [uploadId]); // eslint-disable-line
  // Live refresh so concurrent reviewers see each other's changes
  usePolling(() => load(false), 5000, Boolean(uploadId));

  const replaceRow = (r) => setRows((rs) => rs.map((x) => (x.product_id === r.product_id ? r : x)));

  async function save(row, changes) {
    try {
      replaceRow(await api.patch(row.product_id, row.version, changes));
    } catch (e) {
      if (e.status === 409 && e.detail?.current) {
        replaceRow(e.detail.current);
        notify(`${e.detail.message}. Row reloaded, please re-apply your change.`, "warn");
      } else notify(`Save failed: ${e.message}`, "error");
    }
  }

  async function changeStatus(status) {
    // Only rows currently visible (status + vendor filter) are affected
    const items = visible.filter((r) => selected.has(r.product_id)).map((r) => ({ product_id: r.product_id, version: r.version }));
    if (!items.length) return;
    try {
      const res = await api.setStatus(status, items);
      const parts = [`${res.updated.length} ${status}`];
      if (res.blocked.length) parts.push(`${res.blocked.length} blocked by validation errors`);
      if (res.conflicts.length) parts.push(`${res.conflicts.length} changed by someone else`);
      notify(parts.join(", "), res.blocked.length || res.conflicts.length ? "warn" : "ok");
      setSelected(new Set());
      load(true);
    } catch (e) { notify(e.message, "error"); }
  }

  async function publish() {
    try {
      notify("Publishing approved products to silver…", "ok");
      // With a vendor filter, publish only that vendor's approved products
      const res = await api.publish(uploadId, vKey ? vrows.filter((r) => r.status === "approved").map((r) => r.product_id) : undefined);
      notify(`Published ${res.published} product(s)`, "ok");
      load(true);
    } catch (e) { notify(`Publish failed: ${e.message}`, "error"); }
  }

  // Close the Columns menu on outside click
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);
  const shownCols = COLUMNS.filter((c) => !hidden.includes(c.key));
  const showEdit = !hidden.includes("updated_at");
  const toggleCol = (key) => setHidden((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]));

  // Pinned columns: measure the real widths of columns 1 and 2 so the sticky left offsets never overlap
  useLayoutEffect(() => {
    const t = tableRef.current;
    if (!t) return;
    const c1 = t.querySelector("th.pin-1");
    const c2 = t.querySelector("th.pin-2");
    if (!c1 || !c2) return;
    t.style.setProperty("--pin2-left", `${c1.offsetWidth}px`);
    t.style.setProperty("--pin3-left", `${c1.offsetWidth + c2.offsetWidth}px`);
  });

  // Vendor filter first (case-insensitive Client match), then the status filter
  const vKey = normVendor(vendor);
  const vrows = useMemo(() => (vKey ? rows.filter((r) => normVendor(r.client_id) === vKey) : rows), [rows, vKey]);
  useEffect(() => { setSelected(new Set()); }, [vKey]); // never act on rows hidden by the vendor filter
  const visible = useMemo(() => vrows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "issues") return r.validation_errors?.length > 0;
    return r.status === filter;
  }), [vrows, filter]);

  if (!uploadId) return <div className="panel grid empty-state">Select or upload a document to review its products.</div>;

  const approvedCount = vrows.filter((r) => r.status === "approved").length;
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.product_id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visible.filter((r) => r.status !== "published").map((r) => r.product_id)));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="panel grid">
      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All ({vrows.length})</option>
          <option value="issues">With issues ({vrows.filter((r) => r.validation_errors?.length).length})</option>
          {["pending", "approved", "rejected", "published"].map((s) => (
            <option key={s} value={s}>{s} ({vrows.filter((r) => r.status === s).length})</option>
          ))}
        </select>
        <div className="col-menu" ref={menuRef}>
          <button onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
            Columns{hidden.length ? ` (${hidden.length} hidden)` : ""} ▾
          </button>
          {menuOpen && (
            <div className="col-menu-pop">
              {HIDEABLE.map((h) => (
                <label key={h.key}>
                  <input type="checkbox" checked={!hidden.includes(h.key)} onChange={() => toggleCol(h.key)} /> {h.label}
                </label>
              ))}
              <button className="link" disabled={!hidden.length} onClick={() => setHidden([])}>Show all</button>
            </div>
          )}
        </div>
        <button title="Row height" onClick={() => setDensity((d) => (d === "compact" ? "comfortable" : "compact"))}>
          {density === "compact" ? "Comfortable rows" : "Compact rows"}
        </button>
        <span className="spacer" />
        <button disabled={!selected.size} onClick={() => changeStatus("approved")}>Approve ({selected.size})</button>
        <button disabled={!selected.size} onClick={() => changeStatus("rejected")}>Reject</button>
        <button disabled={!selected.size} onClick={() => changeStatus("pending")}>Back to pending</button>
        <button className="primary" disabled={!approvedCount} onClick={publish}>Publish {approvedCount} approved</button>
      </div>
      {vKey && rows.length > 0 && (
        <div className="vendor-banner">
          Showing <b>{vendor.trim()}</b>: {vrows.length} of {rows.length} products ·
          <button className="link" onClick={onClearVendor}>Clear filter</button>
        </div>
      )}
      {loading ? <div className="empty-state">Loading…</div> : !rows.length ? (
        <div className="empty-state">No products yet. Extraction can take a minute.</div>
      ) : vKey && !vrows.length ? (
        <div className="empty-state">
          This upload has no products for <b>{vendor.trim()}</b>.{" "}
          <button className="link" onClick={onClearVendor}>Clear the vendor filter</button>
        </div>
      ) : (
        <div className={`table-wrap ${density === "compact" ? "compact" : ""}`}>
          <table ref={tableRef}>
            <thead>
              <tr>
                <th className="pin pin-1"><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
                <th className="pin pin-2">Status</th>
                {shownCols.map((c) => (
                  <th key={c.key} className={c.pin ? `pin ${c.pin}` : ""} style={{ width: c.w, minWidth: c.w, maxWidth: c.w }}>{c.label}</th>
                ))}
                <th className="col-issues">Issues</th>
                {showEdit && <th className="col-edit">Last edit</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const issues = r.validation_errors || [];
                return (
                  <tr key={r.product_id} className={`st-${r.status}`}>
                    <td className="pin pin-1"><input type="checkbox" disabled={r.status === "published"} checked={selected.has(r.product_id)} onChange={() => toggle(r.product_id)} /></td>
                    <td className="pin pin-2">
                      <button className="link" title="Open product details" onClick={() => setOpenId(r.product_id)}>Details</button>{" "}
                      <span className={`badge ${r.status}`}>{r.status}</span>
                    </td>
                    {shownCols.map((c) => (
                      <Cell key={c.key} row={r} col={c} issues={issues} onSave={save} setEditing={setEditing} />
                    ))}
                    <td className="issues col-issues clickable" onClick={() => setOpenId(r.product_id)}
                        title={[...issues.map((i) => i.message), "Click to open product details"].join("\n")}>
                      {issues.map((i, n) => <div key={n} className={i.severity}>{i.message}</div>)}
                    </td>
                    {showEdit && (
                      <td className="muted col-edit" title={`${r.updated_by} · ${fmtTime(r.updated_at)}`}>
                        <span>{r.updated_by}</span> <span className="edit-time">{fmtTime(r.updated_at)}</span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {openId && (
        <AiProductPanel
          productId={openId}
          onClose={() => setOpenId(null)}
          onNavigate={setOpenId}
          onChanged={() => load(true)}
          notify={notify}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ingestion check
const FIELD_LABELS = Object.fromEntries(COLUMNS.map((c) => [c.key, c.label]));

function DocumentPreview({ uploadId, upload }) {
  const url = api.fileUrl(uploadId);
  if (upload.preview === "pdf") {
    return <iframe className="doc-frame" title={upload.file_name} src={url} />;
  }
  if (upload.preview === "image") {
    return <div className="doc-image"><img src={url} alt={upload.file_name} /></div>;
  }
  return (
    <div className="empty-state">
      This file type can't be shown in the browser.<br />
      <a href={url} download>Download {upload.file_name}</a> to compare it with the extracted fields.
    </div>
  );
}

function FieldCard({ product }) {
  const issues = product.fields.filter((f) => f.status !== "ok").length;
  return (
    <div className={`field-card st-${product.status}`}>
      <div className="field-card-head">
        <strong>{product.article_description || "(no description)"}</strong>
        <span className={`badge ${product.status}`}>{product.status}</span>
        {issues > 0 && <span className="muted">{issues} field(s) with issues</span>}
      </div>
      <table className="field-table">
        <thead>
          <tr><th>Field</th><th>Extracted</th><th>Current</th><th>Check</th></tr>
        </thead>
        <tbody>
          {product.fields.map((f) => (
            <tr key={f.field} className={`chk-${f.status}`}>
              <td className="fname-cell">{FIELD_LABELS[f.field] || f.field}</td>
              <td className={f.extracted == null ? "missing" : ""}>{f.extracted ?? "(not found)"}</td>
              <td className={f.edited ? "edited" : "muted"}>
                {f.edited ? (f.current ?? "(cleared)") : "same"}
              </td>
              <td>
                {f.status === "ok" ? <span className="ok">ok</span>
                  : f.issues.map((i, n) => <div key={n} className={i.severity}>{i.message}</div>)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IngestionCheck({ uploadId, onSelect, onReview, notify }) {
  const [uploads, setUploads] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.uploads().then((r) => {
      setUploads(r.uploads);
      if (!uploadId && r.uploads.length) onSelect(r.uploads[0].upload_id);
    }).catch((e) => notify(e.message, "error"));
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!uploadId) return;
    setLoading(true);
    setData(null);
    api.fields(uploadId).then(setData).catch((e) => notify(e.message, "error")).finally(() => setLoading(false));
  }, [uploadId, notify]);

  const s = data?.summary;
  const u = data?.upload;
  return (
    <div className="panel ingestion">
      <div className="toolbar">
        <label>Upload&nbsp;
          <select value={uploadId || ""} onChange={(e) => onSelect(e.target.value)}>
            {!uploadId && <option value="">Select an upload</option>}
            {uploads.map((x) => (
              <option key={x.upload_id} value={x.upload_id}>{x.file_name} · {fmtTime(x.uploaded_at)} · {x.status}</option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <button disabled={!uploadId} onClick={onReview}>Review in grid</button>
      </div>
      {!uploadId ? <div className="empty-state">No uploads yet.</div>
        : loading || !data ? <div className="empty-state">Loading…</div> : (
        <>
          <div className="ingest-summary">
            <span><span className={`badge ${u.status}`}>{u.status}</span> {u.file_name}</span>
            <span className="muted">by {u.uploaded_by} · uploaded {fmtTime(u.uploaded_at)} · extracted {fmtTime(u.extracted_at) || "–"}</span>
            <span className="stat"><b>{s.products}</b> products</span>
            <span className="stat"><b>{s.fields_filled}</b>/{s.fields_expected} fields filled</span>
            <span className={`stat ${s.fields_with_errors ? "bad" : ""}`}><b>{s.fields_with_errors}</b> errors</span>
            <span className={`stat ${s.fields_with_warnings ? "warn" : ""}`}><b>{s.fields_with_warnings}</b> warnings</span>
            <span className="stat"><b>{s.fields_edited}</b> edited</span>
            {u.error && <div className="err full">{u.error}</div>}
          </div>
          <div className="ingest-split">
            <div className="ingest-doc"><DocumentPreview uploadId={uploadId} upload={u} /></div>
            <div className="ingest-fields">
              {data.products.length
                ? data.products.map((p) => <FieldCard key={p.product_id} product={p} />)
                : <div className="empty-state">No products were extracted from this document.</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ forecast
function ForecastPage({ notify }) {
  const [client, setClient] = useState("");
  const [data, setData] = useState(null);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useStoredState("plf.forecast.show", { ai: true, ml: true, bands: true });
  const toggle = (k) => setShow((s) => ({ ...s, [k]: !s[k] }));

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.forecast(client || undefined);
      setData(d);
      if (!client && d.clients.length) setClient(d.clients[0]);
    } catch (e) { notify(e.message, "error"); } finally { setLoading(false); }
  }, [client, notify]);
  useEffect(() => { loadData(); }, [client]); // eslint-disable-line

  const latest = runs[0];
  const active = latest && ACTIVE_RUN.includes(latest.status);
  const loadRuns = useCallback(async () => {
    try {
      const { runs: rs } = await api.runs();
      if (rs[0] && ACTIVE_RUN.includes(rs[0].status)) {
        const fresh = await api.run(rs[0].run_id);
        rs[0] = fresh;
        if (fresh.status === "SUCCESS") { notify("Forecast finished", "ok"); loadData(); }
        else if (!ACTIVE_RUN.includes(fresh.status)) notify(`Forecast run ${fresh.status}: ${fresh.state_message || ""}`, "error");
      }
      setRuns(rs);
    } catch (e) { notify(e.message, "error"); }
  }, [notify, loadData]);
  usePolling(loadRuns, active ? 5000 : 30000);

  async function run() {
    try {
      const r = await api.runForecast();
      notify(`Forecast run ${r.run_id} started`, "ok");
      loadRuns();
    } catch (e) {
      notify(e.status === 409 ? "A forecast run is already in progress" : e.message, e.status === 409 ? "warn" : "error");
      loadRuns();
    }
  }

  const series = useMemo(() => {
    if (!data) return [];
    const byDs = new Map();
    const at = (ds) => { if (!byDs.has(ds)) byDs.set(ds, { ds }); return byDs.get(ds); };
    for (const a of data.actuals) at(a.ds).actual = a.actual;
    const last = data.actuals.length ? data.actuals[data.actuals.length - 1] : null;
    if (last) Object.assign(at(last.ds), { forecast: last.actual, forecast_ml: last.actual }); // bridge both lines to the last actual
    for (const f of data.forecast) Object.assign(at(f.ds), { forecast: f.metric_forecast, band: [f.metric_lower, f.metric_upper] });
    for (const f of data.forecast_ml || []) Object.assign(at(f.ds), { forecast_ml: f.metric_forecast, band_ml: [f.metric_lower, f.metric_upper] });
    for (const s of data.scheduled || []) at(s.ds).scheduled = s.scheduled;
    return [...byDs.values()].sort((a, b) => a.ds.localeCompare(b.ds));
  }, [data]);

  const acc = data?.accuracy || {};
  const label = (name, a) => (a?.mase != null ? `${name} (holdout MASE ${a.mase.toFixed(2)})` : name);
  const fmt = (v) => (Array.isArray(v) ? `${v[0].toFixed(1)} – ${v[1].toFixed(1)}` : typeof v === "number" ? v.toFixed(1) : v);
  // Average forecast per model over the 12 weeks, for the summary under the chart
  const avg = (rows) => (rows?.length ? rows.reduce((s, r) => s + r.metric_forecast, 0) / rows.length : null);
  const avgAi = avg(data?.forecast), avgMl = avg(data?.forecast_ml);

  return (
    <div className="panel forecast">
      <div className="toolbar">
        <label>Client&nbsp;
          <select value={client} onChange={(e) => setClient(e.target.value)}>
            {(data?.clients || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <div className="model-toggles">
          <label className="tg-ai"><input type="checkbox" checked={show.ai} onChange={() => toggle("ai")} /> ai_forecast</label>
          <label className="tg-ml"><input type="checkbox" checked={show.ml} onChange={() => toggle("ml")} /> MLflow model</label>
          <label><input type="checkbox" checked={show.bands} onChange={() => toggle("bands")} /> 90% ranges</label>
        </div>
        <span className="spacer" />
        {latest && (
          <span className="muted">
            Last run <a href={latest.run_page_url} target="_blank" rel="noreferrer">{latest.run_id}</a>:{" "}
            <span className={`badge run-${latest.status}`}>{latest.status}</span> by {latest.triggered_by} · {fmtTime(latest.started_at)}
          </span>
        )}
        <button className="primary" disabled={active} onClick={run}>{active ? "Forecast running…" : "Run forecast"}</button>
      </div>
      {loading && !data ? <div className="empty-state">Loading…</div> : !series.length ? (
        <div className="empty-state">No forecast yet. Publish products, then run the forecast.</div>
      ) : (
        <>
          <div className="chart">
            <ResponsiveContainer width="100%" height={420}>
              <ComposedChart data={series} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="ds" />
                <YAxis allowDecimals={false} label={{ value: "Launches / week", angle: -90, position: "insideLeft" }} />
                <Tooltip formatter={fmt} />
                <Legend />
                {data.cutoff && <ReferenceLine x={data.cutoff} stroke="#8a99a0" strokeDasharray="3 3" label={{ value: "cutoff", fontSize: 11, fill: "#5a6f77" }} />}
                {show.ai && show.bands && <Area dataKey="band" name="ai_forecast 90% range" fill="#ff3621" fillOpacity={0.12} stroke="none" />}
                {show.ml && show.bands && <Area dataKey="band_ml" name="MLflow 90% range" fill="#7c3aed" fillOpacity={0.12} stroke="none" />}
                <Line dataKey="actual" name="Actual" stroke="#1b3139" strokeWidth={2} dot />
                {show.ai && <Line dataKey="forecast" name={label("ai_forecast", acc.ai_forecast)} stroke="#ff3621" strokeDasharray="6 4" strokeWidth={2} dot={false} />}
                {show.ml && <Line dataKey="forecast_ml" name={label("MLflow LightGBM", acc.mlflow)} stroke="#7c3aed" strokeDasharray="2 3" strokeWidth={2} dot={false} />}
                <Scatter dataKey="scheduled" name="Scheduled (announced)" fill="#16a34a" shape="diamond" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="model-summary">
            <div className="ms-card ms-ai">
              <b>ai_forecast</b> (Databricks SQL AI function)
              <div>12-week average: {avgAi != null ? `${avgAi.toFixed(1)} launches/week` : "–"}</div>
              <div className="muted">Holdout MASE {acc.ai_forecast?.mase?.toFixed(2) ?? "–"} · 90% range coverage {acc.ai_forecast?.coverage != null ? `${Math.round(acc.ai_forecast.coverage * 100)}%` : "–"} · generated {fmtTime(data.generated_at)} · served from {data.source}</div>
            </div>
            <div className="ms-card ms-ml">
              <b>MLflow LightGBM</b> (global model, retrained each run)
              <div>12-week average: {avgMl != null ? `${avgMl.toFixed(1)} launches/week` : "not run yet"}</div>
              <div className="muted">Holdout MASE {acc.mlflow?.mase?.toFixed(2) ?? "–"} · 90% range coverage {acc.mlflow?.coverage != null ? `${Math.round(acc.mlflow.coverage * 100)}%` : "–"} · generated {fmtTime(data.ml_generated_at)}{data.ml_run_id ? ` · MLflow run ${data.ml_run_id.slice(0, 8)}` : ""}</div>
            </div>
          </div>
          <div className="muted small">MASE below 1 beats a naive last-week forecast; lower is better. History is synthetic test data.</div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Ask Genie panel
function GenieAnswer({ m, onAsk }) {
  const [showSql, setShowSql] = useState(false);
  if (m.pending) return <div className="genie-msg genie-bot muted">Genie is thinking… (usually 10-20 seconds)</div>;
  if (m.failed) return <div className="genie-msg genie-bot genie-err">{m.failed}</div>;
  return (
    <div className="genie-msg genie-bot">
      {m.text && m.text.split("\n").filter(Boolean).map((line, i) => (
        <p key={i} dangerouslySetInnerHTML={{ __html: line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>") }} />
      ))}
      {m.columns?.length > 0 && (
        <div className="genie-table-wrap">
          <table className="genie-table">
            <thead><tr>{m.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{m.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v ?? "–"}</td>)}</tr>)}</tbody>
          </table>
          {m.truncated && <div className="muted small">Showing the first {m.rows.length} of {m.row_count} rows.</div>}
        </div>
      )}
      {m.sql && (
        <div className="small">
          <button className="link" onClick={() => setShowSql((s) => !s)}>{showSql ? "Hide" : "Show"} the SQL Genie ran</button>
          {showSql && <pre className="genie-sql">{m.sql}</pre>}
        </div>
      )}
      {m.suggested_questions?.length > 0 && (
        <div className="genie-suggest">{m.suggested_questions.map((q) => <button key={q} className="chip-btn" onClick={() => onAsk(q)}>{q}</button>)}</div>
      )}
    </div>
  );
}

// Prominent Genie section below a chart: the analysis Genie already wrote, what you can ask, and an inline thread.
function GenieInsights({ scope, itemKey, title, chips = [] }) {
  const [state, setState] = useState(null);        // response of /api/genie/insight
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [input, setInput] = useState("");
  const busy = messages.some((m) => m.pending);
  const threadEnd = useRef(null);

  // Load the opening analysis; while Genie is still writing it, check again every 3 seconds
  useEffect(() => {
    if (!itemKey) return undefined;
    let stop = false, timer = null;
    setState(null); setMessages([]); setConversationId(null);
    const load = async () => {
      try {
        const r = await api.genieInsight(scope, itemKey);
        if (stop) return;
        setState(r);
        if (r.status === "generating" || r.status === "missing") timer = setTimeout(load, 3000);
      } catch (e) {
        if (!stop) setState({ status: "error", error: e.message });
      }
    };
    load();
    return () => { stop = true; clearTimeout(timer); };
  }, [scope, itemKey]);
  useEffect(() => { if (messages.length) threadEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages]);

  async function refresh() {
    try {
      const r = await api.refreshInsight(scope, itemKey);
      setState(r);
      const poll = async () => {
        const x = await api.genieInsight(scope, itemKey);
        setState(x);
        if (x.status === "generating") setTimeout(poll, 3000);
      };
      setTimeout(poll, 3000);
    } catch (e) { setState((s) => ({ ...s, status: "error", error: e.message })); }
  }

  async function ask(q) {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    setInput("");
    const id = Math.random().toString(36).slice(2);
    setMessages((ms) => [...ms, { id: `${id}-q`, role: "user", text: question }, { id, role: "genie", pending: true }]);
    try {
      const r = await api.askGenie(question, conversationId);
      setConversationId(r.conversation_id);
      const failed = r.status === "FAILED" ? (r.error || "Genie could not answer this question.") : null;
      setMessages((ms) => ms.map((m) => (m.id === id ? { id, role: "genie", ...r, failed } : m)));
    } catch (e) {
      setMessages((ms) => ms.map((m) => (m.id === id ? { id, role: "genie", failed: e.message } : m)));
    }
  }

  const ins = state?.insight;
  const analysis = ins && ins.text ? { text: ins.text, sql: ins.sql, columns: ins.columns, rows: ins.rows, row_count: ins.rows?.length || 0,
                                       suggested_questions: [] } : null;
  const generating = !state || state.status === "generating" || state.status === "missing";
  const nextQuestions = [...new Set([...(ins?.suggested || [])])].slice(0, 3);

  return (
    <section className="genie-insights">
      <div className="gi-head">
        <div>
          <h3>✨ Genie insights{title ? <span className="gi-title"> · {title}</span> : null}</h3>
          <div className="muted small">Genie turns plain-language questions into SQL on the governed sales, forecast and changeover tables, and answers with live results.</div>
        </div>
        <span className="genie-badge">Powered by Databricks Genie</span>
      </div>

      <div className="gi-analysis">
        <div className="gi-label">Genie's analysis</div>
        {generating && !analysis && <div className="genie-msg genie-bot muted"><span className="gi-spinner" /> Genie is analyzing this {scope === "product" ? "product" : "changeover"}… (about 20-30 seconds)</div>}
        {state?.status === "failed" && !analysis && <div className="genie-msg genie-bot genie-err">Genie couldn't finish this analysis: {ins?.error || "unknown error"}</div>}
        {state?.status === "error" && <div className="genie-msg genie-bot genie-err">{state.error}</div>}
        {analysis && <GenieAnswer m={analysis} onAsk={ask} />}
        {analysis && (
          <div className="muted small gi-meta">
            {generating ? <><span className="gi-spinner" /> Updating with the latest data… · </> : null}
            Written {fmtTime(ins.updated_at)}{!state?.current && !generating ? " · data has changed since" : ""} ·{" "}
            <button className="link" onClick={refresh} disabled={generating}>Refresh analysis</button>
          </div>
        )}
      </div>

      <div className="gi-label">What you can ask Genie</div>
      <div className="gi-chips">
        {chips.map((g) => (
          <div key={g.group} className="gi-chip-group">
            <div className="gi-group">{g.group}</div>
            {g.questions.map((q) => <button key={q} className="chip-btn" disabled={busy} onClick={() => ask(q)}>{q}</button>)}
          </div>
        ))}
      </div>
      {nextQuestions.length > 0 && messages.length === 0 && (
        <div className="gi-next"><span className="gi-group">Genie suggests next</span>
          {nextQuestions.map((q) => <button key={q} className="chip-btn" disabled={busy} onClick={() => ask(q)}>{q}</button>)}</div>
      )}

      <form className="gi-input" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} maxLength={2000}
               placeholder={conversationId ? "Ask a follow-up… e.g. \"break that down by month\"" : `Ask anything about ${title || "sales, forecasts and changeovers"}…`} />
        <button className="primary" disabled={busy || !input.trim()}>{busy ? "Genie is answering…" : "Ask Genie"}</button>
      </form>

      {messages.length > 0 && (
        <div className="gi-thread">
          {messages.map((m) => (m.role === "user"
            ? <div key={m.id} className="genie-msg genie-user">{m.text}</div>
            : <GenieAnswer key={m.id} m={m} onAsk={ask} />))}
          <div ref={threadEnd} />
          <button className="link small" onClick={() => { setMessages([]); setConversationId(null); }}>New conversation</button>
        </div>
      )}
      <div className="muted small">Answers can be wrong; check the SQL for important decisions. Sales data is synthetic.</div>
    </section>
  );
}

// ------------------------------------------------------------------ sales forecast per product
const MODEL_LABEL = { mlflow_lightgbm: "MLflow LightGBM", ai_forecast: "ai_forecast" };

function SalesForecastPage({ notify, vendor, onVendor }) {
  const [meta, setMeta] = useState(null);
  const [productKey, setProductKey] = useStoredState("plf.sales.product", "");
  const [data, setData] = useState(null);
  const [runs, setRuns] = useState([]);
  const [show, setShow] = useStoredState("plf.sales.show", { ai: true, ml: true, bands: true });
  const toggle = (k) => setShow((s) => ({ ...s, [k]: !s[k] }));

  const loadMeta = useCallback(() => api.salesProducts().then(setMeta).catch((e) => notify(e.message, "error")), [notify]);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  const vKey = normVendor(vendor);
  const products = useMemo(() => (meta?.products || []).filter((p) => !vKey || normVendor(p.client_id) === vKey), [meta, vKey]);
  const current = products.find((p) => p.product_key === productKey) || products[0] || null;

  const loadData = useCallback(() => {
    if (!current) { setData(null); return; }
    api.salesForecast(current.product_key).then(setData).catch((e) => notify(e.message, "error"));
  }, [current?.product_key, notify]); // eslint-disable-line
  useEffect(() => { setData(null); loadData(); }, [loadData]);

  const latest = runs[0];
  const active = latest && ACTIVE_RUN.includes(latest.status);
  const loadRuns = useCallback(async () => {
    try {
      const { runs: rs } = await api.runs();
      if (rs[0] && ACTIVE_RUN.includes(rs[0].status)) {
        const fresh = await api.run(rs[0].run_id);
        rs[0] = fresh;
        if (fresh.status === "SUCCESS") { notify("Sales forecast finished", "ok"); loadMeta(); loadData(); }
        else if (!ACTIVE_RUN.includes(fresh.status)) notify(`Forecast run ${fresh.status}: ${fresh.state_message || ""}`, "error");
      }
      setRuns(rs);
    } catch (e) { notify(e.message, "error"); }
  }, [notify, loadMeta, loadData]);
  usePolling(loadRuns, active ? 5000 : 30000);

  async function run() {
    try {
      const r = await api.runForecast();
      notify(`Sales forecast run ${r.run_id} started`, "ok");
      loadRuns();
    } catch (e) {
      notify(e.status === 409 ? "A forecast run is already in progress" : e.message, e.status === 409 ? "warn" : "error");
      loadRuns();
    }
  }

  const series = useMemo(() => {
    if (!data) return [];
    const byWeek = new Map();
    const at = (wk) => { if (!byWeek.has(wk)) byWeek.set(wk, { week: wk }); return byWeek.get(wk); };
    for (const a of data.actuals) at(a.week).actual = a.units;
    const last = data.actuals[data.actuals.length - 1];
    if (last) Object.assign(at(last.week), { ai: last.units, ml: last.units }); // bridge both lines to the last actual
    for (const f of data.forecast) {
      const k = f.model === "ai_forecast" ? "ai" : "ml";
      Object.assign(at(f.week), { [k]: f.forecast_units, [`${k}_band`]: [f.lower_units, f.upper_units] });
    }
    return [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
  }, [data]);

  const acc = meta?.accuracy || {};
  const total = (m) => (data ? data.forecast.filter((f) => f.model === m).reduce((s, f) => s + f.forecast_units, 0) : null);
  const lastYear = useMemo(() => {
    if (!data?.actuals.length) return null;
    const weeks = new Set(data.forecast.map((f) => f.week));
    const shifted = data.actuals.filter((a) => weeks.has(addWeeks(a.week, 52)));
    return shifted.length === 12 ? shifted.reduce((s, a) => s + a.units, 0) : null;
  }, [data]);
  const label = (m) => `${MODEL_LABEL[m]}${acc[m] ? ` (holdout error ${acc[m].wape_pct.toFixed(1)}%)` : ""}`;
  const chips = current ? [
    { group: "Compare", questions: [`How does ${current.article_description} compare with other ${current.category} products in forecast growth vs last year?`] },
    { group: "Rank", questions: [`Which 5 ${current.client_id} products are forecast to grow most vs the same weeks last year?`] },
    { group: "Explain", questions: [`Why do mlflow_lightgbm and ai_forecast differ for ${current.article_description}, and which model was more accurate?`] },
    { group: "Drill down", questions: [`Show the weekly forecast for ${current.article_description} next to actual sales in the same weeks last year`] },
  ] : [];

  if (!meta) return <div className="panel"><div className="empty-state">Loading…</div></div>;
  if (meta.error) {
    return <div className="panel"><div className="empty-state">{meta.error === "no_access"
      ? "The app can't read the sales forecast yet (it needs SELECT on gold.sales_forecast, gold.product_weekly_sales and gold.sales_forecast_accuracy)."
      : "No sales forecast yet. Click Run forecast."}</div></div>;
  }
  const vendors = [...new Set(meta.products.map((p) => p.client_id))].sort();
  return (
    <div className="panel forecast">
      <div className="toolbar">
        <select value={vendor} onChange={(e) => onVendor(e.target.value)} title="Vendor">
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={current?.product_key || ""} onChange={(e) => setProductKey(e.target.value)} title="Product" className="product-select">
          {products.map((p) => <option key={p.product_key} value={p.product_key}>{p.article_description} ({p.client_id})</option>)}
        </select>
        <div className="model-toggles">
          <label className="tg-ml"><input type="checkbox" checked={show.ml} onChange={() => toggle("ml")} /> MLflow model</label>
          <label className="tg-ai"><input type="checkbox" checked={show.ai} onChange={() => toggle("ai")} /> ai_forecast</label>
          <label><input type="checkbox" checked={show.bands} onChange={() => toggle("bands")} /> 90% ranges</label>
        </div>
        <span className="spacer" />
        {latest && <span className="muted small"><span className={`badge run-${latest.status}`}>{latest.status}</span> {fmtTime(latest.started_at)}</span>}
        <button className="primary" disabled={active} onClick={run}>{active ? "Forecast running…" : "Run forecast"}</button>
      </div>
      {!current ? <div className="empty-state">No products for this vendor.</div> : !data ? <div className="empty-state">Loading…</div> : (
        <>
          <div className="muted small">{current.category} · GTIN {current.current_gtin} · weekly units sold, all stores (old + new GTIN combined)</div>
          <div className="chart">
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={series} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" />
                <YAxis label={{ value: "Units / week", angle: -90, position: "insideLeft" }} />
                <Tooltip formatter={(v) => (Array.isArray(v) ? `${Math.round(v[0])} – ${Math.round(v[1])}` : typeof v === "number" ? Math.round(v) : v)} />
                <Legend />
                {show.ml && show.bands && <Area dataKey="ml_band" name="MLflow 90% range" fill="#7c3aed" fillOpacity={0.12} stroke="none" />}
                {show.ai && show.bands && <Area dataKey="ai_band" name="ai_forecast 90% range" fill="#ff3621" fillOpacity={0.12} stroke="none" />}
                <Line dataKey="actual" name="Actual" stroke="#1b3139" strokeWidth={2} dot={false} />
                {show.ml && <Line dataKey="ml" name={label("mlflow_lightgbm")} stroke="#7c3aed" strokeDasharray="2 3" strokeWidth={2} dot={false} />}
                {show.ai && <Line dataKey="ai" name={label("ai_forecast")} stroke="#ff3621" strokeDasharray="6 4" strokeWidth={2} dot={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="model-summary">
            {["mlflow_lightgbm", "ai_forecast"].map((m) => (
              <div key={m} className={`ms-card ${m === "ai_forecast" ? "ms-ai" : "ms-ml"}`}>
                <b>{MODEL_LABEL[m]}</b>{m === "mlflow_lightgbm" ? " (global model, retrained each run)" : " (Databricks SQL AI function)"}
                <div>Next 12 weeks: {total(m) != null ? `${Math.round(total(m)).toLocaleString()} units` : "–"}
                  {lastYear ? ` · ${pct((total(m) / lastYear - 1) * 100)} vs same weeks last year` : ""}</div>
                <div className="muted">Holdout error (WAPE) {acc[m] ? `${acc[m].wape_pct.toFixed(1)}%` : "–"} · 90% range coverage {acc[m] ? `${Math.round(acc[m].coverage_pct)}%` : "–"} · bias {acc[m] ? pct(acc[m].bias_pct) : "–"}</div>
              </div>
            ))}
          </div>
          <div className="muted small">Holdout error = total absolute error when forecasting the last 12 weeks without seeing them (all products); lower is better. Sales are synthetic demo data.</div>
          <GenieInsights scope="product" itemKey={current.product_key} title={current.article_description} chips={chips} />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ changeover impact
const pct = (v, digits = 1) => (v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`);
const addWeeks = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7 * n); return d.toISOString().slice(0, 10); };

function EffectBadge({ c }) {
  if (c.status !== "measured") return <span className={`effect-badge e-${c.status}`}>{c.status === "pending" ? "pending" : "not enough data"}</span>;
  const cls = !c.significant ? "e-flat" : c.effect_pct > 0 ? "e-up" : "e-down";
  return <span className={`effect-badge ${cls}`} title={c.significant ? "Clear effect (95% range excludes 0)" : "No clear effect (95% range includes 0)"}>{pct(c.effect_pct)}</span>;
}

function ChangeoverPage({ notify, vendor, onVendor }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [weeks, setWeeks] = useState(null);

  useEffect(() => {
    api.changeovers().then((d) => {
      setData(d);
      const first = d.changeovers.find((c) => c.status === "measured") || d.changeovers[0];
      setSelected((s) => s || first?.gtin_old || null);
    }).catch((e) => notify(e.message, "error"));
  }, [notify]);

  const vKey = normVendor(vendor);
  const list = useMemo(() => (data?.changeovers || []).filter((c) => !vKey || normVendor(c.client_id) === vKey), [data, vKey]);
  const current = list.find((c) => c.gtin_old === selected) || list[0] || null;

  useEffect(() => {
    if (!current) { setWeeks(null); return; }
    setWeeks(null);
    api.changeoverWeekly(current.gtin_old).then((d) => setWeeks(d.weeks)).catch((e) => notify(e.message, "error"));
  }, [current?.gtin_old, notify]); // eslint-disable-line

  if (!data) return <div className="panel"><div className="empty-state">Loading…</div></div>;
  if (data.error) {
    return (
      <div className="panel"><div className="empty-state">
        {data.error === "no_access"
          ? "The app can't read the changeover results yet (it needs SELECT on gold.changeover_impact and gold.changeover_weekly)."
          : "No changeover results yet. Run the src/analysis/changeover_impact notebook."}
      </div></div>
    );
  }
  const measured = list.filter((c) => c.status === "measured");
  const other = list.filter((c) => c.status !== "measured");
  const item = (c) => (
    <li key={c.gtin_old} className={current?.gtin_old === c.gtin_old ? "sel" : ""} onClick={() => setSelected(c.gtin_old)}>
      <div className="co-row"><span className="co-name">{c.article_description}</span><EffectBadge c={c} /></div>
      <div className="muted small">{c.client_id} · {c.category} · switch {c.launch_date}{c.status === "measured" && c.controls_fit === false ? " · ⚠ check controls" : ""}</div>
    </li>
  );

  return (
    <div className="changeover-layout">
      <div className="panel co-list">
        <div className="uploads-head"><h2>GTIN changeovers</h2></div>
        <select className="vendor-select" value={vendor} onChange={(e) => onVendor(e.target.value)}>
          <option value="">All vendors ({data.changeovers.length})</option>
          {data.clients.map((v) => <option key={v} value={v}>{v} ({data.changeovers.filter((c) => c.client_id === v).length})</option>)}
        </select>
        <div className="co-scroll">
          <h3>Measured <span className="muted">{measured.length}</span></h3>
          {measured.length ? <ul className="co-items">{measured.map(item)}</ul> : <p className="muted small">None for this vendor.</p>}
          <h3>Pending <span className="muted">{other.length}</span></h3>
          {other.length ? <ul className="co-items">{other.map(item)}</ul> : <p className="muted small">None for this vendor.</p>}
        </div>
      </div>
      <div className="panel co-detail">
        {!current ? <div className="empty-state">No changeovers for this vendor.</div> : (
          <>
            <div className="co-head">
              <div>
                <h2>{current.article_description}</h2>
                <div className="muted">{current.client_id} · {current.category} · GTIN {current.gtin_old} → {current.gtin_new} · switch week {current.launch_date}</div>
              </div>
              <EffectBadge c={current} />
            </div>
            {current.status === "measured" ? (
              <div className="kpis">
                <div className="kpi"><div className="kpi-label">Effect on weekly units</div><div className="kpi-value">{pct(current.effect_pct)}</div>
                  <div className="muted small">95% range {pct(current.ci_low)} to {pct(current.ci_high)}{current.significant ? "" : " · no clear effect"}</div></div>
                <div className="kpi"><div className="kpi-label">Units per week</div><div className="kpi-value">{Math.round(current.units_per_week_pre)} → {Math.round(current.units_per_week_post)}</div>
                  <div className="muted small">raw before vs after (includes seasonality)</div></div>
                <div className="kpi"><div className="kpi-label">Transition dip</div><div className="kpi-value">{pct(current.transition_dip_pct)}</div>
                  <div className="muted small">first 3 weeks, old and new stock overlap</div></div>
                <div className="kpi"><div className="kpi-label">Revenue effect</div><div className="kpi-value">{pct(current.revenue_effect_pct)}</div>
                  <div className="muted small">compared with {current.n_controls} control products</div></div>
              </div>
            ) : (
              <div className="kpis">
                <div className="kpi"><div className="kpi-label">Current sales</div><div className="kpi-value">{Math.round(current.units_per_week_pre ?? 0)} units/week</div>
                  <div className="muted small">average of the last 12 weeks</div></div>
                <div className="kpi"><div className="kpi-label">Impact measurable from</div><div className="kpi-value">{addWeeks(current.launch_date, 15)}</div>
                  <div className="muted small">needs 12 weeks after the 3-week transition</div></div>
                <div className="kpi"><div className="kpi-label">Controls</div><div className="kpi-value">{current.n_controls ?? "–"}</div>
                  <div className="muted small">same-category products without a change</div></div>
              </div>
            )}
            {current.status === "measured" && current.controls_fit === false && (
              <div className="co-warn">⚠ Before the switch this product was already drifting away from its controls (trend p = {current.pretrend_p?.toFixed(2)}), so treat the effect with extra caution.</div>
            )}
            <div className="chart">
              {!weeks ? <div className="empty-state">Loading chart…</div> : (
                <ResponsiveContainer width="100%" height={340}>
                  <ComposedChart data={weeks} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="week" />
                    <YAxis label={{ value: "Units / week (all stores)", angle: -90, position: "insideLeft" }} />
                    <Tooltip formatter={(v) => (typeof v === "number" ? Math.round(v) : v)} />
                    <Legend />
                    {current.status === "measured" && (
                      <ReferenceArea x1={current.launch_date} x2={addWeeks(current.launch_date, 2)} fill="#8a99a0" fillOpacity={0.15} label={{ value: "transition", fontSize: 11, fill: "#5a6f77" }} />
                    )}
                    <Line dataKey="actual_units" name="Actual (old + new GTIN)" stroke="#1b3139" strokeWidth={2} dot={false} />
                    {current.status === "measured" && (
                      <Line dataKey="expected_units" name="Expected without the change" stroke="#ff3621" strokeDasharray="6 4" strokeWidth={2} dot={false} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="muted small">
              {current.status === "measured"
                ? "Expected = what this product would have sold without the change, based on same-category controls, adjusted for promotions, store and week."
                : `Shows the last 26 weeks. The switch is on ${current.launch_date}.`}
              {current.is_synthetic_data ? " Sales are synthetic demo data." : ""} Evaluated {fmtTime(current.evaluated_at)}.
            </div>
            <GenieInsights scope="changeover" itemKey={current.gtin_old} title={current.article_description} chips={[
              { group: "Compare", questions: [`How does the ${current.article_description} changeover compare with the other ${current.category} changeovers?`] },
              { group: "Rank", questions: ["Rank all measured changeovers by their effect on weekly unit sales, with the 95% range"] },
              { group: "Explain", questions: [current.status === "measured"
                ? `How reliable is the estimated effect for ${current.article_description}, and what does controls_fit mean here?`
                : "Which changeovers are still pending and when will their effect become measurable?"] },
              { group: "Drill down", questions: [`Show weekly actual and expected units for ${current.article_description} around its changeover`] },
            ]} />
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ architecture view
// Node kinds map to Databricks product areas (colour-coded, see legend)
const KINDS = {
  user: { label: "User", cls: "k-user" },
  app: { label: "Databricks App", cls: "k-app" },
  uc: { label: "Unity Catalog storage (Delta / Volume)", cls: "k-uc" },
  sql: { label: "SQL warehouse + AI functions", cls: "k-sql" },
  lakebase: { label: "Lakebase Postgres", cls: "k-lb" },
  ai: { label: "Model Serving (LLM)", cls: "k-ai" },
  job: { label: "Lakeflow Jobs / pipelines", cls: "k-job" },
};

function Node({ kind, title, sub, href }) {
  const body = (<><div className="n-title">{title}</div>{sub && <div className="n-sub">{sub}</div>}</>);
  return href
    ? <a className={`arch-node ${KINDS[kind].cls}`} href={href} target="_blank" rel="noreferrer" title="Open in Databricks">{body}</a>
    : <div className={`arch-node ${KINDS[kind].cls}`}>{body}</div>;
}

function FlowRow({ n, title, nodes, note }) {
  return (
    <div className="arch-row">
      <div className="arch-step"><span className="step">{n}</span> {title}</div>
      <div className="arch-chain">
        {nodes.map((nd, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="arch-arrow" aria-hidden="true">{nd.label ? <small>{nd.label}</small> : null}→</span>}
            <Node {...nd} />
          </React.Fragment>
        ))}
      </div>
      {note && <div className="arch-note">{note}</div>}
    </div>
  );
}

function ArchitectureView({ onClose }) {
  const [a, setA] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api.architecture().then(setA).catch((e) => setErr(e.message)); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const lb = a?.lakebase;
  const N = a && {
    user: { kind: "user", title: "Business users", sub: "browser" },
    app: { kind: "app", title: "Databricks App", sub: `${a.app.name} · React + FastAPI`, href: a.app.url },
    volume: { kind: "uc", title: "UC Volume", sub: `${a.volume.name} (uploads/)`, href: a.volume.url },
    wh: { kind: "sql", title: "SQL warehouse", sub: "ai_parse_document + ai_extract", href: a.warehouse.url },
    whMerge: { kind: "sql", title: "SQL warehouse", sub: "MERGE (idempotent)", href: a.warehouse.url },
    queue: { kind: "lakebase", title: "Lakebase review queue", sub: `${lb.project} · ${lb.schema}.review_products` },
    audit: { kind: "lakebase", title: "Lakebase", sub: `${lb.schema}.review_audit (edit history)` },
    sugg: { kind: "lakebase", title: "Lakebase", sub: `${lb.schema}.ai_suggestions` },
    model: { kind: "ai", title: "Model Serving", sub: a.model.name, href: a.model.url },
    silver: { kind: "uc", title: "Delta silver", sub: a.silver.name, href: a.silver.url },
    job: { kind: "job", title: "Lakeflow Job", sub: `run_forecast · ai_forecast (12 weeks)`, href: a.job.url },
    gold: { kind: "uc", title: "Delta gold", sub: a.gold.name, href: a.gold.url },
    sync: { kind: "job", title: "Synced-table pipeline", sub: "sync_forecast_to_lakebase", href: a.job.url },
    synced: { kind: "lakebase", title: "Lakebase synced table", sub: lb.synced_table || "gold.launch_forecasts_synced" },
  };

  return (
    <div className="arch-overlay" onClick={onClose}>
      <div className="arch-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Architecture">
        <div className="arch-head">
          <h2>Architecture &amp; data flow</h2>
          <span className="muted">Components are read from this app's live configuration; click one to open it in Databricks.</span>
          <span className="spacer" />
          <button onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        {err && <div className="empty-state">Could not load the architecture: {err}</div>}
        {!a && !err && <div className="empty-state">Loading…</div>}
        {a && (
          <div className="arch-body">
            <div className="arch-legend">
              {Object.entries(KINDS).map(([k, v]) => <span key={k} className={`legend-item ${v.cls}`}>{v.label}</span>)}
            </div>

            <h3>In the app (interactive)</h3>
            <FlowRow n="1" title="Upload" nodes={[N.user, N.app, N.volume]}
                     note="Files go to the raw documents volume under uploads/, which the daily job skips." />
            <FlowRow n="2" title="Extract" nodes={[N.volume, N.wh, N.queue]}
                     note="Parses the document and extracts products; results and the document text land in the review queue as pending." />
            <FlowRow n="3" title="Review & validate" nodes={[N.user, N.app, N.queue, N.audit]}
                     note="Version-checked edits (safe for many reviewers), GTIN check digit / date / duplicate validation, audit trail." />
            <FlowRow n="4" title="AI suggestion" nodes={[N.app, N.model, N.sugg]}
                     note="Model proposes fixes for errors; each is re-validated and checked against the document; a reviewer applies or dismisses." />
            <FlowRow n="5" title="Publish" nodes={[N.queue, N.whMerge, N.silver]}
                     note="Approved products are merged into silver on document_id, so re-publishing never duplicates." />
            <FlowRow n="6" title="Forecast" nodes={[N.app, N.job, N.gold]}
                     note={`Runs job tasks ${a.job.tasks.join(", ")}; gold is replaced on each run (weekly, Monday-based).`} />
            <FlowRow n="7" title="Serve the forecast" nodes={[N.gold, N.sync, N.synced, N.app]}
                     note="Charts read the Lakebase copy (fast, no warehouse start); they fall back to gold via the warehouse." />

            <h3>Daily batch pipeline (scheduled job)</h3>
            <FlowRow n="B" title="Documents dropped by clients" nodes={[
              { kind: "uc", title: "UC Volume", sub: `${a.volume.name} (outside uploads/)`, href: a.volume.url },
              { kind: "job", title: "Lakeflow Job", sub: "setup_catalog → extract_product_data", href: a.job.url },
              N.silver, N.job, N.gold,
            ]} note="Same AI functions on the SQL warehouse, without human review; only new files are processed." />

            <h3>Components</h3>
            <table className="arch-table">
              <thead><tr><th>Component</th><th>Databricks product</th><th>This deployment</th><th>Used for</th></tr></thead>
              <tbody>
                <tr><td>App</td><td>Databricks Apps</td><td><a href={a.app.url} target="_blank" rel="noreferrer">{a.app.name}</a></td><td>UI and API; runs as its own service principal</td></tr>
                <tr><td>Governance</td><td>Unity Catalog</td><td><a href={a.catalog.url} target="_blank" rel="noreferrer">{a.catalog.name}</a></td><td>bronze / silver / gold schemas, grants to the app</td></tr>
                <tr><td>Raw documents</td><td>UC Volume</td><td><a href={a.volume.url} target="_blank" rel="noreferrer">{a.volume.path}</a></td><td>Uploaded and client-dropped files</td></tr>
                <tr><td>Compute</td><td>SQL warehouse (serverless)</td><td>{a.warehouse.url ? <a href={a.warehouse.url} target="_blank" rel="noreferrer">{a.warehouse.id}</a> : "–"}</td><td>ai_parse_document, ai_extract, MERGE, ai_forecast</td></tr>
                <tr><td>Products</td><td>Delta table</td><td><a href={a.silver.url} target="_blank" rel="noreferrer">{a.silver.name}</a></td><td>Published, standardised products</td></tr>
                <tr><td>Forecast</td><td>Delta table (change data feed)</td><td><a href={a.gold.url} target="_blank" rel="noreferrer">{a.gold.name}</a></td><td>12-week forecast with 90% interval</td></tr>
                <tr><td>Review queue</td><td>Lakebase Postgres</td><td>{lb.project} / {lb.branch} / {lb.database}.{lb.schema}</td><td>{lb.tables.join(", ")}</td></tr>
                <tr><td>Fast reads</td><td>Lakebase synced table</td><td>{lb.synced_table || "–"}</td><td>Forecast copy for charts</td></tr>
                <tr><td>AI fixes</td><td>Model Serving (Foundation Model API)</td><td><a href={a.model.url} target="_blank" rel="noreferrer">{a.model.name}</a></td><td>Suggested corrections with evidence</td></tr>
                <tr><td>Orchestration</td><td>Lakeflow Jobs</td><td>{a.job.url ? <a href={a.job.url} target="_blank" rel="noreferrer">job {a.job.id}</a> : "–"}</td><td>Daily pipeline, forecast runs, synced-table refresh</td></tr>
                <tr><td>Deployment</td><td>Declarative Automation Bundle + Git</td><td>databricks.yml, resources/*.yml</td><td>Deploys the job, app, Lakebase project and synced table</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ app shell
export default function App() {
  const [tab, setTab] = useState("review");
  const [me, setMe] = useState(null);
  const [uploadId, setUploadId] = useState(null);
  const [toasts, setToasts] = useState([]);

  const notify = useCallback((text, kind = "ok") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 9000 : 5000);
  }, []);

  useEffect(() => { api.me().then(setMe).catch(() => {}); }, []);
  // Shared by the upload history and the review grid; remembered per browser
  const [vendor, setVendor] = useStoredState("plf.vendor", "");
  const [collapsed, setCollapsed] = useStoredState("plf.uploads.collapsed", false);
  const [showArch, setShowArch] = useState(false);

  return (
    <div className="app">
      <header>
        <h1>Product Launch Forecast</h1>
        <nav>
          <button className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>Upload &amp; review</button>
          <button className={tab === "check" ? "on" : ""} onClick={() => setTab("check")}>Ingestion check</button>
          <button className={tab === "forecast" ? "on" : ""} onClick={() => setTab("forecast")}>Forecast</button>
          <button className={tab === "impact" ? "on" : ""} onClick={() => setTab("impact")}>Changeover impact</button>
        </nav>
        <button className="arch-btn" onClick={() => setShowArch(true)} title="Architecture, Databricks components and data flow">Architecture</button>
        <span className="user">{me?.email}</span>
      </header>
      {showArch && <ArchitectureView onClose={() => setShowArch(false)} />}
      <main>
        {tab === "review" ? (
          <div className={`review-layout ${collapsed ? "collapsed" : ""}`}>
            <UploadPanel
              selected={uploadId} onSelect={setUploadId} notify={notify}
              collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)}
              vendor={vendor} onVendor={setVendor}
            />
            <ReviewGrid uploadId={uploadId} notify={notify} vendor={vendor} onClearVendor={() => setVendor("")} />
          </div>
        ) : tab === "check" ? (
          <IngestionCheck uploadId={uploadId} onSelect={setUploadId} onReview={() => setTab("review")} notify={notify} />
        ) : tab === "impact" ? (
          <ChangeoverPage notify={notify} vendor={vendor} onVendor={setVendor} />
        ) : (
          <SalesForecastPage notify={notify} vendor={vendor} onVendor={setVendor} />
        )}
      </main>
      <Toasts items={toasts} onClose={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
