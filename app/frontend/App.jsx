import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "./api.js";

const COLUMNS = [
  { key: "client_id", label: "Client", width: 110 },
  { key: "article_description", label: "Description", width: 220 },
  { key: "launch_date", label: "Launch date", width: 130, type: "date" },
  { key: "identifier_old", label: "Old ID", width: 140 },
  { key: "identifier_new", label: "New ID", width: 140 },
  { key: "identifier_type", label: "ID type", width: 80 },
  { key: "size", label: "Size", width: 80 },
  { key: "packaging", label: "Packaging", width: 100 },
  { key: "category", label: "Category", width: 120 },
  { key: "notes", label: "Notes", width: 180 },
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
function UploadPanel({ selected, onSelect, notify }) {
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

  return (
    <div className="panel uploads">
      <div
        className={`dropzone ${drag ? "drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); send(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" multiple hidden accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.tif,.tiff"
               onChange={(e) => send(e.target.files)} />
        {busy ? "Uploading…" : <>Drop launch documents here or <u>browse</u><br /><small>PDF, DOCX, images</small></>}
      </div>
      <h3>Uploads</h3>
      <ul className="upload-list">
        {uploads.map((u) => (
          <li key={u.upload_id} className={u.upload_id === selected ? "active" : ""} onClick={() => onSelect(u.upload_id)}>
            <div className="row1">
              <span className="fname" title={u.file_name}>{u.file_name}</span>
              <span className={`badge ${u.status}`}>{u.status}</span>
            </div>
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
        {!uploads.length && <li className="empty">No uploads yet</li>}
      </ul>
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
  return (
    <td className={level} title={fieldIssues.map((i) => i.message).join("\n")}>
      <input
        type={col.type === "date" ? "date" : "text"}
        value={value ?? ""}
        disabled={disabled}
        style={{ width: col.width }}
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

function ReviewGrid({ uploadId, notify }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(false);
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
    const items = rows.filter((r) => selected.has(r.product_id)).map((r) => ({ product_id: r.product_id, version: r.version }));
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
      const res = await api.publish(uploadId);
      notify(`Published ${res.published} product(s)`, "ok");
      load(true);
    } catch (e) { notify(`Publish failed: ${e.message}`, "error"); }
  }

  const visible = useMemo(() => rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "issues") return r.validation_errors?.length > 0;
    return r.status === filter;
  }), [rows, filter]);

  if (!uploadId) return <div className="panel grid empty-state">Select or upload a document to review its products.</div>;

  const approvedCount = rows.filter((r) => r.status === "approved").length;
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.product_id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visible.filter((r) => r.status !== "published").map((r) => r.product_id)));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="panel grid">
      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All ({rows.length})</option>
          <option value="issues">With issues ({rows.filter((r) => r.validation_errors?.length).length})</option>
          {["pending", "approved", "rejected", "published"].map((s) => (
            <option key={s} value={s}>{s} ({rows.filter((r) => r.status === s).length})</option>
          ))}
        </select>
        <span className="spacer" />
        <button disabled={!selected.size} onClick={() => changeStatus("approved")}>Approve ({selected.size})</button>
        <button disabled={!selected.size} onClick={() => changeStatus("rejected")}>Reject</button>
        <button disabled={!selected.size} onClick={() => changeStatus("pending")}>Back to pending</button>
        <button className="primary" disabled={!approvedCount} onClick={publish}>Publish {approvedCount} approved</button>
      </div>
      {loading ? <div className="empty-state">Loading…</div> : !rows.length ? (
        <div className="empty-state">No products yet. Extraction can take a minute.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
                <th>Status</th>
                {COLUMNS.map((c) => <th key={c.key}>{c.label}</th>)}
                <th>Issues</th>
                <th>Last edit</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const issues = r.validation_errors || [];
                return (
                  <tr key={r.product_id} className={`st-${r.status}`}>
                    <td><input type="checkbox" disabled={r.status === "published"} checked={selected.has(r.product_id)} onChange={() => toggle(r.product_id)} /></td>
                    <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                    {COLUMNS.map((c) => (
                      <Cell key={c.key} row={r} col={c} issues={issues} onSave={save} setEditing={setEditing} />
                    ))}
                    <td className="issues">
                      {issues.map((i, n) => <div key={n} className={i.severity}>{i.message}</div>)}
                    </td>
                    <td className="muted">{r.updated_by}<br />{fmtTime(r.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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

  return (
    <div className="app">
      <header>
        <h1>Product Launch Forecast</h1>
        <nav>
          <button className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>Upload &amp; review</button>
          <button className={tab === "forecast" ? "on" : ""} onClick={() => setTab("forecast")}>Forecast</button>
        </nav>
        <span className="user">{me?.email}</span>
      </header>
      <main>
        {tab === "review" ? (
          <div className="review-layout">
            <UploadPanel selected={uploadId} onSelect={setUploadId} notify={notify} />
            <ReviewGrid uploadId={uploadId} notify={notify} />
          </div>
        ) : (
          <ForecastPage notify={notify} />
        )}
      </main>
      <Toasts items={toasts} onClose={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
