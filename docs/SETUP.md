# Setup and run guide

This document walks through **everything** you need: prerequisites, HubSpot configuration, environment variables, local run modes, and production.

---

## 1. Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js** | **v20+** recommended (v22 used in Docker / Render examples). Check with `node -v`. |
| **npm** | Comes with Node. Check with `npm -v`. |
| **HubSpot developer account** | Free: [developers.hubspot.com](https://developers.hubspot.com). You create a **private app** or **OAuth app** depending on HubSpot’s current UI; you need **Client ID**, **Client secret**, and a **Redirect URL** that matches this project. |
| **Git** | Optional, for cloning/pushing your repo. |

Repository layout:

- `server/` — Fastify API (Node, JavaScript)
- `client/` — React + TypeScript (Vite)

---

## 2. HubSpot app configuration

You must register an app and align **redirect URL** and **scopes** with this codebase.

### 2.1 Create or open your app

1. Sign in at [developers.hubspot.com](https://developers.hubspot.com).
2. Create an app (or open an existing one) that supports **OAuth** (install flow / authorization URL).
3. Open **Auth** (or equivalent) and copy:
   - **Client ID**
   - **Client secret**

### 2.2 Redirect URL (must match exactly)

The browser is sent to HubSpot, then HubSpot redirects back to **your server**:

- **Local (API on port 3001):**  
  `http://127.0.0.1:3001/callback`  
  Add this exact URL in the HubSpot app’s allowed redirect URLs.

- **Production (single host, API + SPA):**  
  `https://YOUR_DOMAIN/callback`  
  Same string must appear in HubSpot **and** in `HUBSPOT_REDIRECT_URI`.

Use **`127.0.0.1`** (not `localhost`) if you follow the default `.env.example`, so it matches character-for-character.

### 2.3 Scopes

This project defaults to reading CRM contacts:

- Scope string: **`crm.objects.contacts.read`**

In HubSpot, enable the same scope (or whatever you set in `HUBSPOT_SCOPES`). The **Authorize** URL built by `GET /connect` must not request scopes your app is not allowed to use.

---

## 3. Server environment variables

### 3.1 Create or edit `server/.env`

The repo may already include **`server/.env`** with **static placeholders** for local wiring. Replace `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, and optionally tighten `HUBSPOT_STATE_SECRET` before connecting to a real HubSpot app.

If you start from scratch:

```bash
cd server
copy .env.example .env    # Windows CMD
# or
cp .env.example .env      # macOS / Linux / Git Bash
```

`npm run dev` and `npm start` in **`server/`** load this file via Node’s **`--env-file=.env`** (Node 20+).

Edit **`server/.env`** and set:

| Variable | Required | Description |
|----------|----------|-------------|
| `HUBSPOT_CLIENT_ID` | Yes | From HubSpot app. |
| `HUBSPOT_CLIENT_SECRET` | Yes | From HubSpot app. |
| `HUBSPOT_REDIRECT_URI` | Yes | Must match HubSpot redirect config (e.g. `http://127.0.0.1:3001/callback`). |
| `HUBSPOT_STATE_SECRET` | Yes | Long random string (**at least 16 characters**); used to HMAC-sign OAuth `state`. |
| `HUBSPOT_SCOPES` | Optional | Default: `crm.objects.contacts.read`. Space-separated if multiple. |
| `FRONTEND_URL` | Yes | Where `/callback` redirects after success (no trailing slash). Local two-terminal setup: `http://127.0.0.1:5173`. Same-origin: `http://127.0.0.1:3001`. |
| `PORT` | Optional | Default `3001`. |
| `SERVE_STATIC` | Optional | Set to `true` to serve the built SPA from the API (see §5). |
| `CLIENT_DIST_PATH` | Optional | Absolute or resolved path to `client/dist` if not next to `server/` as in the repo. |
| `DEV_ROUTES_ENABLED` | Optional | Set to `true` for Loom: `GET /dev/token-meta`, `POST /dev/expire-token` (no secrets returned). |

**Security:** Never commit `.env` or real secrets. `.gitignore` already ignores `.env`.

---

## 4. Install dependencies

From the **repository root** (folder that contains `server/` and `client/`):

```bash
cd server
npm install

cd ../client
npm install
```

---

## 5. How to run locally

There are two common ways.

### Option A — Two terminals (recommended for development)

**Why:** Vite dev server proxies browser calls from `/api/*` to the API on port 3001.

1. **Terminal 1 — API**

   ```bash
   cd server
   npm run dev
   ```

   Confirm it listens on **`http://127.0.0.1:3001`** (or your `PORT`).

2. **Terminal 2 — Client**

   ```bash
   cd client
   npm run dev
   ```

3. Open **`http://127.0.0.1:5173`** in the browser.

4. In **`server/.env`** set:

   - `HUBSPOT_REDIRECT_URI=http://127.0.0.1:3001/callback`
   - `FRONTEND_URL=http://127.0.0.1:5173`

5. Click **Connect HubSpot** → complete consent → you should land back on the SPA with success. Then **Get Contacts**.

**API quick checks (optional):**

```bash
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/connect
```

`GET /connect` returns JSON `{ "authorizeUrl": "..." }` when env is valid.

---

### Option B — One server (API + built SPA, same origin)

**Why:** One port; closer to production “single URL”.

1. Build the client:

   ```bash
   cd client
   npm run build
   ```

2. In **`server/.env`** set:

   - `HUBSPOT_REDIRECT_URI=http://127.0.0.1:3001/callback`
   - `FRONTEND_URL=http://127.0.0.1:3001`

3. Start the server with static files enabled.

   **Windows PowerShell:**

   ```powershell
   cd server
   $env:SERVE_STATIC = "true"
   node src/index.js
   ```

   **macOS / Linux:**

   ```bash
   cd server
   export SERVE_STATIC=true
   node src/index.js
   ```

4. Open **`http://127.0.0.1:3001`**.

The server resolves the built UI from `client/dist` relative to the repo layout (`server/src` → `../../client/dist`).

---

## 6. Client environment (split API host only)

For **local dev with Vite**, you normally **do not** need a client `.env`.

If the API is on **another origin** (e.g. API on Railway, SPA on Vercel), create **`client/.env`** (see `client/.env.example`):

```env
VITE_API_BASE_URL=https://your-api-host.example.com
```

Then rebuild the client:

```bash
cd client
npm run build
```

The server already enables permissive CORS for demos (`origin: true`); tighten this for real products.

---

## 7. Production / live URL

### One public URL (recommended for OAuth)

Use **`Dockerfile`** or **`render.yaml`** so **HTTPS** serves both API routes and the SPA.

Set in the hosting dashboard (or container env):

- `HUBSPOT_REDIRECT_URI` = `https://YOUR_DOMAIN/callback`
- `FRONTEND_URL` = `https://YOUR_DOMAIN`
- `SERVE_STATIC=true` (and ensure `client/dist` exists in the image / build output)
- For assignment Loom steps: `DEV_ROUTES_ENABLED=true`

**HubSpot:** The redirect URL in the HubSpot app must **exactly** match `HUBSPOT_REDIRECT_URI` (including `https` and no trailing slash on the origin for the redirect path `/callback`).

### Render (`render.yaml`)

- Connect the repo to Render and use the blueprint, **or** set **Build** / **Start** commands as in `render.yaml`.
- Add all **secret** env vars in the Render dashboard.

### Docker

From the **repository root**:

```bash
docker build -t hubspot-oauth-demo .
docker run -p 3000:3000 \
  -e HUBSPOT_CLIENT_ID=... \
  -e HUBSPOT_CLIENT_SECRET=... \
  -e HUBSPOT_REDIRECT_URI=https://YOUR_DOMAIN/callback \
  -e HUBSPOT_STATE_SECRET=... \
  -e FRONTEND_URL=https://YOUR_DOMAIN \
  hubspot-oauth-demo
```

The image listens on **`PORT` (default 3000)** inside the container; map it to a host port with `-p`.

---

## 8. Troubleshooting

| Problem | What to check |
|---------|----------------|
| **`EADDRINUSE` / port in use** | Another process is using `PORT` (default 3001). Stop the old terminal or set `PORT=3002` in `server/.env` and use the same port in `HUBSPOT_REDIRECT_URI` and HubSpot settings. |
| **Redirect URI mismatch** | HubSpot redirect list must **exactly** equal `HUBSPOT_REDIRECT_URI` (scheme, host, port, path). |
| **`invalid_or_expired_state` after OAuth** | Clock skew is rare; usually **wrong `HUBSPOT_STATE_SECRET`** between restarts, or **multiple server instances** with different secrets. Use one server process and a stable `.env`. |
| **`not_connected` on Get Contacts** | Finish OAuth first; tokens are **in-memory** — **restarting the server clears them**. |
| **`server_misconfigured` on `/connect`** | Missing `HUBSPOT_CLIENT_ID`, `HUBSPOT_REDIRECT_URI`, or `HUBSPOT_STATE_SECRET`. |
| **CORS / network errors (split deploy)** | Set `VITE_API_BASE_URL` at **build** time; rebuild after changing it. |
| **Vite `/api` 404** | Ensure the **API** is running on 3001 and you opened the **Vite** URL (5173), not only the API URL. |

Logs are **one JSON object per line** on stdout. Search for `event` (e.g. `http_request`, `token_refresh_ok`).

---

## 9. Quick verification checklist

- [ ] `GET /health` → `{ "ok": true }`
- [ ] `GET /connect` → `{ "authorizeUrl": "https://app.hubspot.com/oauth/..." }`
- [ ] Browser: **Connect HubSpot** → return to app with `?connected=1`
- [ ] **Get Contacts** → JSON with `results` (may be empty if portal has no contacts)
- [ ] (Optional) `DEV_ROUTES_ENABLED=true`: **Show token store** / **Force expire** then **Get Contacts** again and watch logs for refresh

---

## 10. Related files

| File | Purpose |
|------|---------|
| `server/.env.example` | Server variable template |
| `client/.env.example` | Optional `VITE_API_BASE_URL` for split hosts |
| `Dockerfile` | Single-container API + static SPA |
| `render.yaml` | Example Render Web service |
| `README.md` | Overview, features, submission notes |

If something in this guide drifts from the code, trust the **code** and `.env.example`; open an issue or update the doc in the same PR.
