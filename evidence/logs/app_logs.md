# App logs

Captured 2026-11-21 with `databricks apps logs product-launch-forecast --tail-lines 200` (39,868 characters, read in full). The excerpts below are copied line for line, with three things masked: the end user's public IP (`<client-ip>`), the internal proxy IPs (`<proxy-ip>`), and the user's numeric id (`<user-id>`). The first number on each line is the log's epoch timestamp in seconds; `[BUILD]` lines come from the deployment, `[APP]` from the app process, `[HTTP]` from the Databricks Apps proxy.

## What the log shows

| Area | Result |
| --- | --- |
| Deployment `01f1e5ba8d58119bae2fb14a1366b97f` | Source downloaded, Python requirements unchanged, `npm` install, `vite build` in 2.85 s, "Deployment successful" after 8.8 s |
| Startup | Lakebase schema ready, server running, Genie insights: "0 queued, 58 already current" |
| Requests | Pages and API calls from a browser session (uploads, product details, sales forecast, changeovers, Genie insights, architecture). All returned 200 except one |
| Error | **One 500**: `GET /api/uploads` at 15:19:02 UTC failed with `psycopg.errors.AdminShutdown` (details below); the next requests succeeded |
| Warnings | One SDK warning (file endpoints, 403, defaults used); a front-end bundle-size warning and 2 npm audit findings during the build |

## Deployment and startup

```text
1795272487 [BUILD] [INFO] Starting deployment 01f1e5ba8d58119bae2fb14a1366b97f...
1795272487 [APP] INFO:     Shutting down
1795272487 [APP] INFO:     Waiting for application shutdown.
1795272487 [APP] INFO:     Application shutdown complete.
1795272487 [APP] INFO:     Finished server process [2169]
1795272487 [BUILD] [INFO] Downloading source code from /Workspace/Users/730b6b55-c3cc-4c74-b390-b7eabc90c933/src/01f1e5ba8d58119bae2fb14a1366b97f
1795272488 [BUILD] [INFO] Updated file: python/source_code/app.yaml
1795272488 [BUILD] [INFO] Updated file: python/source_code/index.html
1795272488 [BUILD] [INFO] Updated file: python/source_code/package.json
1795272488 [BUILD] [INFO] Updated file: python/source_code/requirements.txt
1795272488 [BUILD] [INFO] Updated file: python/source_code/vite.config.js
1795272488 [BUILD] [INFO] Updated file: python/source_code/.gitignore
1795272488 [BUILD] [INFO] Updated file: python/source_code/SPEC.md
1795272488 [BUILD] [INFO] Updated file: python/source_code/backend/__init__.py
1795272488 [BUILD] [INFO] Updated file: python/source_code/backend/config.py
1795272488 [BUILD] [INFO] Updated file: python/source_code/backend/db.py
1795272489 [BUILD] [INFO] Updated file: python/source_code/backend/extraction.py
1795272489 [BUILD] [INFO] Updated file: python/source_code/backend/main.py
1795272489 [BUILD] [INFO] Updated file: python/source_code/backend/validation.py
1795272489 [BUILD] [INFO] Updated file: python/source_code/backend/warehouse.py
1795272489 [BUILD] [INFO] Updated file: python/source_code/backend/suggestions.py
1795272489 [BUILD] [INFO] Updated file: python/source_code/backend/insights.py
1795272489 [BUILD] [INFO] Updated file: python/source_code/frontend/App.jsx
1795272489 [BUILD] [INFO] Updated file: python/source_code/frontend/api.js
1795272489 [BUILD] [INFO] Updated file: python/source_code/frontend/main.jsx
1795272489 [BUILD] [INFO] Updated file: python/source_code/frontend/styles.css
1795272489 [BUILD] [INFO] Updated file: python/source_code/frontend/theme.css
1795272490 [BUILD] [INFO] Installing Python dependencies...
1795272490 [BUILD] [INFO] Requirements have not changed. Skipping installation.
1795272490 [BUILD] [INFO] Installing dependencies...
1795272490 [BUILD] 
up to date, audited 102 packages in 675ms
1795272490 [BUILD] 
7 packages are looking for funding
1795272490 [BUILD]   run `npm fund` for details
1795272490 [BUILD] 
2 vulnerabilities (1 moderate, 1 high)

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
1795272490 [BUILD] [INFO] Dependencies installed successfully.
1795272491 [BUILD] [INFO] Running build script vite build
1795272491 [BUILD] 
> product-launch-forecast-ui@0.1.0 build
> vite build
1795272491 [BUILD] vite v5.4.21 building for production...
1795272491 [BUILD] transforming...
1795272493 [BUILD] ✓ 628 modules transformed.
1795272494 [BUILD] rendering chunks...
1795272494 [BUILD] computing gzip size...
1795272494 [BUILD] dist/index.html                   0.41 kB │ gzip:   0.28 kB
1795272494 [BUILD] dist/assets/index-CrcRa4On.css   37.71 kB │ gzip:   8.45 kB
1795272494 [BUILD] dist/assets/index-BQO1YuQe.js   634.83 kB │ gzip: 179.91 kB
1795272494 [BUILD] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
1795272494 [BUILD] ✓ built in 2.85s
1795272494 [BUILD] [INFO] Build completed successfully.
1795272494 [BUILD] [INFO] Starting app with command: [uvicorn backend.main:app --host 0.0.0.0 --port 8000]
1795272495 [APP] INFO:     Started server process [2268]
1795272495 [APP] INFO:     Waiting for application startup.
1795272496 [BUILD] [INFO] Deployment 01f1e5ba8d58119bae2fb14a1366b97f ended in 8.843999205s
1795272496 [BUILD] [INFO] Deployment successful
1795272497 [APP] INFO:backend.db:Lakebase schema review ready
1795272497 [APP] INFO:     Application startup complete.
1795272497 [APP] INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
1795272507 [APP] INFO:backend.insights:Genie insights: 0 queued, 58 already current
```

## A browser session (excerpt)

From the [APP] side, opening the app, a document's fields and file, the sales forecast for one product with its Genie insight, and the changeover page:

```text
1795272715 [APP] INFO:     <proxy-ip>:0 - "GET / HTTP/1.1" 200 OK
1795272715 [APP] INFO:     <proxy-ip>:0 - "GET /assets/index-BQO1YuQe.js HTTP/1.1" 200 OK
1795272715 [APP] INFO:     <proxy-ip>:0 - "GET /assets/index-CrcRa4On.css HTTP/1.1" 200 OK
1795272715 [APP] INFO:     <proxy-ip>:0 - "GET /api/me HTTP/1.1" 200 OK
1795272715 [APP] INFO:     <proxy-ip>:0 - "GET /favicon.ico HTTP/1.1" 200 OK
1795272715 [APP] INFO:     <proxy-ip>:0 - "GET /api/uploads HTTP/1.1" 200 OK
1795272718 [APP] INFO:     <proxy-ip>:0 - "GET /api/uploads HTTP/1.1" 200 OK
1795272719 [APP] INFO:     <proxy-ip>:0 - "GET /api/uploads/73c90c26-eddb-4af0-aa3b-8fa45d1b3237/fields HTTP/1.1" 200 OK
1795272719 [APP] WARNING:databricks.sdk.mixins.files:Unexpected status resolving file endpoints (403, request ID 028a21f7-bea0-44f9-a781-f0d27c4a6567), using the default endpoints.
1795272719 [APP] INFO:     <proxy-ip>:0 - "GET /api/uploads/73c90c26-eddb-4af0-aa3b-8fa45d1b3237/file HTTP/1.1" 200 OK
1795272720 [APP] INFO:     <proxy-ip>:0 - "GET /api/forecast/runs HTTP/1.1" 200 OK
1795272722 [APP] INFO:     <proxy-ip>:0 - "GET /api/sales-forecast/products HTTP/1.1" 200 OK
1795272724 [APP] INFO:     <proxy-ip>:0 - "GET /api/sales-forecast/4015000103015 HTTP/1.1" 200 OK
1795272724 [APP] INFO:     <proxy-ip>:0 - "GET /api/genie/insight?scope=product&key=4015000103015 HTTP/1.1" 200 OK
1795272732 [APP] INFO:     <proxy-ip>:0 - "GET /api/changeovers HTTP/1.1" 200 OK
1795272733 [APP] INFO:     <proxy-ip>:0 - "GET /api/genie/insight?scope=changeover&key=8710400100065 HTTP/1.1" 200 OK
1795272733 [APP] INFO:     <proxy-ip>:0 - "GET /api/changeovers/8710400100065/weekly HTTP/1.1" 200 OK
1795272742 [APP] INFO:     <proxy-ip>:0 - "GET /api/architecture HTTP/1.1" 200 OK
```

The same requests as seen by the Apps proxy, with the response size in bytes (two examples):

```text
1795272724 [HTTP] <client-ip> - <user-id>@7474647099307852 [21/Nov/2026:14:52:02 +0000] "GET /api/sales-forecast/4015000103015 HTTP/1.1" 200 9355 "https://product-launch-forecast-7474647099307852.aws.databricksapps.com/" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36"
1795272725 [HTTP] <client-ip> - <user-id>@7474647099307852 [21/Nov/2026:14:52:04 +0000] "GET /api/genie/insight HTTP/1.1" 200 6482 "https://product-launch-forecast-7474647099307852.aws.databricksapps.com/" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36"
```

## The one error: a stale Lakebase connection

```text
1795274342 [APP] INFO:     <proxy-ip>:0 - "GET / HTTP/1.1" 200 OK
1795274342 [APP] WARNING:psycopg.pool:discarding closed connection: <backend.db._TokenConnection [BAD] at 0x7f39b52ea750>
1795274342 [APP] INFO:     <proxy-ip>:0 - "GET /api/uploads HTTP/1.1" 500 Internal Server Error
1795274342 [APP] ERROR:    Exception in ASGI application
Traceback (most recent call last):
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/uvicorn/protocols/http/httptools_impl.py", line 401, in run_asgi
    result = await app(  # type: ignore[func-returns-value]
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/uvicorn/middleware/proxy_headers.py", line 70, in __call__
    return await self.app(scope, receive, send)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/fastapi/applications.py", line 1054, in __call__
    await super().__call__(scope, receive, send)
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/starlette/applications.py", line 113, in __call__
    await self.middleware_stack(scope, receive, send)
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/starlette/middleware/errors.py", line 187, in __call__
    raise exc
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/starlette/middleware/errors.py", line 165, in __call__
    await self.app(scope, receive, _send)
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/starlette/middleware/exceptions.py", line 62, in __call__
    await wrap_app_handling_exceptions(self.app, conn)(scope, receive, send)
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/starlette/_exception_handler.py", line 62, in wrapped_app
    raise exc
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/starlette/_exception_handler.py", line 51, in wrapped_app
    await app(scope, receive, sender)
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/starlette/routing.py", line 715, in __call__
    await self.middleware_stack(scope, receive, send)
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/starlette/routing.py", line 735, in app
    await route.handle(scope, receive, send)
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/starlette/routing.py", line 288, in handle
    await self.app(scope, receive, send)
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/starlette/routing.py", line 76, in app
    await wrap_app_handling_exceptions(app, request)(scope, receive, send)
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/starlette/_exception_handler.py", line 62, in wrapped_app
    raise exc
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/starlette/_exception_handler.py", line 51, in wrapped_app
    await app(scope, receive, sender)
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/starlette/routing.py", line 73, in app
    response = await f(request)
               ^^^^^^^^^^^^^^^^
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/fastapi/routing.py", line 301, in app
    raw_response = await run_endpoint_function(
                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/fastapi/routing.py", line 214, in run_endpoint_function
    return await run_in_threadpool(dependant.call, **values)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/starlette/concurrency.py", line 39, in run_in_threadpool
    return await anyio.to_thread.run_sync(func, *args)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/anyio/to_thread.py", line 63, in run_sync
    return await get_async_backend().run_sync_in_worker_thread(
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/anyio/_backends/_asyncio.py", line 2518, in run_sync_in_worker_thread
    return await future
           ^^^^^^^^^^^^
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/anyio/_backends/_asyncio.py", line 1002, in run
    result = context.run(func, *args)
             ^^^^^^^^^^^^^^^^^^^^^^^^
  File "/app/python/source_code/backend/main.py", line 259, in list_uploads
    cur.execute(
  File "/app/python/source_code/.venv/lib/python3.11/site-packages/psycopg/cursor.py", line 117, in execute
    raise ex.with_traceback(None)
psycopg.errors.AdminShutdown: terminating connection due to administrator command
1795274342 [APP] INFO:     <proxy-ip>:0 - "GET /api/me HTTP/1.1" 200 OK
1795274342 [APP] INFO:     <proxy-ip>:0 - "GET /favicon.ico HTTP/1.1" 200 OK
1795274342 [HTTP] <client-ip> - <user-id>@7474647099307852 [21/Nov/2026:15:19:02 +0000] "GET /api/uploads HTTP/1.1" 500 21 "https://product-launch-forecast-7474647099307852.aws.databricksapps.com/" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36"
1795274350 [APP] INFO:     <proxy-ip>:0 - "GET /api/uploads HTTP/1.1" 200 OK
1795274350 [APP] INFO:     <proxy-ip>:0 - "GET /api/uploads HTTP/1.1" 200 OK
```

**What happened:** this request came about 26 minutes after the previous one. In the meantime Lakebase had closed the app's pooled database connection (the endpoint suspends after 5 minutes idle), and the pool handed that closed connection to the request, so the query failed with `AdminShutdown`. The pool then discarded it, and the same request 8 seconds later succeeded.

**Impact and fix:** a user who opens the app after a long idle period can see one failed load of the upload list. Not yet fixed; the usual remedy is to have the pool check a connection before handing it out (psycopg_pool `check=ConnectionPool.check_connection`) or retry once on `OperationalError`.
