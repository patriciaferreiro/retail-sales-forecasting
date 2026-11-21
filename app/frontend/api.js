// Thin fetch wrapper. Errors carry the HTTP status and the FastAPI `detail` payload.
export class ApiError extends Error {
  constructor(status, detail) {
    super(typeof detail === "string" ? detail : detail?.message || `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

async function request(method, path, body, isForm = false) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    if (isForm) opts.body = body;
    else {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(path, opts);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.detail ?? data);
  return data;
}

export const api = {
  me: () => request("GET", "/api/me"),
  uploads: () => request("GET", "/api/uploads"),
  upload: (files) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    return request("POST", "/api/uploads", form, true);
  },
  retry: (id) => request("POST", `/api/uploads/${id}/retry`),
  products: (uploadId) => request("GET", `/api/uploads/${uploadId}/products`),
  fields: (uploadId) => request("GET", `/api/uploads/${uploadId}/fields`),
  fileUrl: (uploadId) => `/api/uploads/${uploadId}/file`,
  text: (uploadId) => request("GET", `/api/uploads/${uploadId}/text`),
  detail: (productId) => request("GET", `/api/products/${productId}/detail`),
  suggest: (productId, field) => request("POST", `/api/products/${productId}/suggest`, { field: field ?? null }),
  suggestions: (productId) => request("GET", `/api/products/${productId}/suggestions`),
  applySuggestion: (id, version) => request("POST", `/api/suggestions/${id}/apply`, { version }),
  dismissSuggestion: (id) => request("POST", `/api/suggestions/${id}/dismiss`),
  patch: (id, version, changes) => request("PATCH", `/api/products/${id}`, { version, changes }),
  setStatus: (status, items) => request("POST", "/api/products/status", { status, items }),
  audit: (id) => request("GET", `/api/products/${id}/audit`),
  publish: (uploadId) => request("POST", "/api/publish", { upload_id: uploadId ?? null }),
  runForecast: () => request("POST", "/api/forecast/run"),
  runs: () => request("GET", "/api/forecast/runs"),
  run: (id) => request("GET", `/api/forecast/runs/${id}`),
  forecast: (clientId) =>
    request("GET", `/api/forecast${clientId ? `?client_id=${encodeURIComponent(clientId)}` : ""}`),
};
