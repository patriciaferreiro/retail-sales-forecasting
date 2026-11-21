import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
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
function UploadPanel({ selected, onSelect, notify, compact = false, canExpand = true, onToggleCollapse, vendor = "", onVendor }) {
  const [uploads, setUploads] = useState([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);
  // Compact mode: close the dropdown on outside click
  useEffect(() => {
    if (!compact || !open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [compact, open]);

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

  const pick = (id) => { onSelect(id); setOpen(false); };
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

  if (!compact) {
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

  // Collapsed (or narrow window): one slim bar above the grid; past uploads open as a dropdown
  return (
    <div className={`panel uploads compact ${drag ? "drag" : ""}`} ref={wrapRef} {...dropHandlers}>
      {fileInput}
      <div className="uploads-bar">
        <button className="primary" disabled={busy} onClick={openPicker} title="Upload a new file (or drop it on this bar)">
          {busy ? "Uploading…" : "Upload file"}
        </button>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open}>Past uploads ({filtered.length}) ▾</button>
        <span className="fname" title={current?.file_name}>{current ? current.file_name : "No file selected"}</span>
        {current && <span className={`badge ${current.status}`}>{current.status}</span>}
        <span className="spacer" />
        {vendorSelect}
        {canExpand && (
          <button className="icon-btn" title="Show the upload history panel" aria-label="Show the upload history panel" onClick={onToggleCollapse}>»</button>
        )}
      </div>
      {open && (
        <div className="uploads-drop">
          <div className="drop-title">Review past uploads <span className="muted">{filtered.length} of {uploads.length}</span></div>
          {filterNotes}
          {list}
        </div>
      )}
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
    for (const a of data.actuals) byDs.set(a.ds, { ds: a.ds, actual: a.actual });
    const lastActual = data.actuals.length ? data.actuals[data.actuals.length - 1] : null;
    if (lastActual) byDs.get(lastActual.ds).forecast = lastActual.actual; // bridge point
    for (const f of data.forecast) {
      const p = byDs.get(f.ds) || { ds: f.ds };
      p.forecast = f.metric_forecast;
      p.band = [f.metric_lower, f.metric_upper];
      byDs.set(f.ds, p);
    }
    return [...byDs.values()].sort((a, b) => a.ds.localeCompare(b.ds));
  }, [data]);

  return (
    <div className="panel forecast">
      <div className="toolbar">
        <label>Client&nbsp;
          <select value={client} onChange={(e) => setClient(e.target.value)}>
            {(data?.clients || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
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
                <Tooltip />
                <Legend />
                <Area dataKey="band" name="90% interval" fill="#c7d7f5" stroke="none" />
                <Line dataKey="actual" name="Actual" stroke="#1b3139" strokeWidth={2} dot />
                <Line dataKey="forecast" name="Forecast" stroke="#ff3621" strokeDasharray="6 4" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="muted small">
            Forecast generated {fmtTime(data.generated_at)} · served from {data.source}
          </div>
        </>
      )}
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
  const narrow = useMediaQuery("(max-width: 1100px)");
  // Shared by the upload history and the review grid; remembered per browser
  const [vendor, setVendor] = useStoredState("plf.vendor", "");
  const [collapsed, setCollapsed] = useStoredState("plf.uploads.collapsed", false);
  const compactUploads = collapsed || narrow; // narrow windows always use the compact bar

  return (
    <div className="app">
      <header>
        <h1>Product Launch Forecast</h1>
        <nav>
          <button className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>Upload &amp; review</button>
          <button className={tab === "check" ? "on" : ""} onClick={() => setTab("check")}>Ingestion check</button>
          <button className={tab === "forecast" ? "on" : ""} onClick={() => setTab("forecast")}>Forecast</button>
        </nav>
        <span className="user">{me?.email}</span>
      </header>
      <main>
        {tab === "review" ? (
          <div className={`review-layout ${compactUploads ? "narrow" : ""}`}>
            <UploadPanel
              selected={uploadId} onSelect={setUploadId} notify={notify}
              compact={compactUploads} canExpand={!narrow} onToggleCollapse={() => setCollapsed((c) => !c)}
              vendor={vendor} onVendor={setVendor}
            />
            <ReviewGrid uploadId={uploadId} notify={notify} vendor={vendor} onClearVendor={() => setVendor("")} />
          </div>
        ) : tab === "check" ? (
          <IngestionCheck uploadId={uploadId} onSelect={setUploadId} onReview={() => setTab("review")} notify={notify} />
        ) : (
          <ForecastPage notify={notify} />
        )}
      </main>
      <Toasts items={toasts} onClose={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
