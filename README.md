# HubSpot OAuth connector (CWA assignment)

Node **Fastify** API plus a minimal **React + TypeScript** SPA. Tokens live in an in-memory `Map` (single demo connection). Structured **JSON logs** include route, latency, and HubSpot response status (`partnerStatus`). **Tokens are never logged and never returned** from JSON APIs.

**Live demo:** replace this line after you deploy — `https://YOUR-SERVICE.onrender.com` (or your chosen host).

**Full setup and run instructions:** [docs/SETUP.md](docs/SETUP.md) (prerequisites, HubSpot, env vars, local + production, troubleshooting).

## Features (spec)

| Area | Behavior |
|------|----------|
| OAuth state | HMAC-SHA256 over a base64url payload; validated with `crypto.timingSafeEqual` |
| `GET /connect` | `{ authorizeUrl }` with HubSpot authorize URL + signed `state` |
| `GET /callback` | Validates state → exchanges `code` → stores tokens → redirects to SPA |
| `GET /contacts` | Up to 25 contacts (default), optional `?after=` cursor from `paging.next.after` |
| 401 handling | Refresh (single-flight per connection) → retry HubSpot **once** → then a **clean** JSON error (no stack traces) |
| 429 | Clean `rate_limited` error |
| Dev (Loom) | With `DEV_ROUTES_ENABLED=true`: `GET /dev/token-meta`, `POST /dev/expire-token` (metadata only) |

## Single-flight refresh (per connection)

`tokenStore.js` keeps a `Map<connectionId, Promise<void>>` named `refreshInFlight`. On HubSpot **401**, `/contacts` calls `runRefreshSingleFlight(conn, doRefresh)`: the first caller creates the refresh `Promise`; concurrent callers await the **same** promise, so **one** token refresh runs for that connection even under burst traffic. After it settles, each request performs its own single HubSpot retry with the updated access token.

## Local setup

1. **HubSpot app** ([developers.hubspot.com](https://developers.hubspot.com)): create a public/legacy OAuth app, note **Client ID** and **Client secret**, enable scope **`crm.objects.contacts.read`** (or match `HUBSPOT_SCOPES`), set redirect URL to `http://127.0.0.1:3001/callback` for local API.

2. **Server env** — edit `server/.env` (placeholders included) or copy `server/.env.example`. `npm run dev` / `npm start` in `server/` load it via `--env-file=.env` (Node 20+).

3. **Terminal A — API**

   ```bash
   cd server
   npm install
   npm run dev
   ```

4. **Terminal B — SPA (Vite proxies `/api` → `http://127.0.0.1:3001`)**

   ```bash
   cd client
   npm install
   npm run dev
   ```

5. Open `http://127.0.0.1:5173` → **Connect HubSpot** → consent → you return to the SPA with `?connected=1` → **Get Contacts**.

### Same-origin local test (optional)

Build the client, then run the server with static hosting:

```bash
cd client && npm run build && cd ../server
set SERVE_STATIC=true   # Windows PowerShell: $env:SERVE_STATIC='true'
node src/index.js
```

Open `http://127.0.0.1:3001` and set `FRONTEND_URL` to that origin in `.env`.

## Production (one public URL)

Recommended: **Docker** (`Dockerfile`) or **Render** (`render.yaml`) so **API + SPA share one HTTPS origin**. Then:

- `HUBSPOT_REDIRECT_URI` = `https://YOUR_DOMAIN/callback`
- `FRONTEND_URL` = `https://YOUR_DOMAIN` (no trailing slash)
- HubSpot app redirect must match exactly.

Enable Loom helpers on the server:

- `DEV_ROUTES_ENABLED=true`

Split deploy (API on another host): build the client with `VITE_API_BASE_URL=https://your-api.host` and configure CORS (this server uses `@fastify/cors` with `origin: true`).

## Loom (≤ 3 min) checklist

Record against the **live** URL (not localhost):

1. Landing page → **Connect HubSpot** → consent → redirect back with success.
2. **Get Contacts** → real contacts JSON.
3. **Show token store (meta only)** (or server logs) → **Force expire access token** so `expiresAt` is in the past (no secrets on screen).
4. **Get Contacts** again → in server logs: `hubspot_401_refresh_scheduled` → `token_refresh_ok` → contacts still render.

## Submission (email)

To **tools@chatwithads.com**, subject **`CWA Assignment — [Your Name]`**, include:

- Public **GitHub** repo URL  
- **Live URL** (README “Live demo” line updated)  
- **Loom** link (unlisted is fine; must play without login)  
- One paragraph: time spent + one thing you would ship next on day 1  

## What I would add next (example)

Multi-tenant storage (encrypted refresh tokens in Postgres), keyed by HubSpot `portalId` from the token metadata endpoint, plus webhook subscriptions for contact changes instead of polling-only.

## License

MIT (assignment demo).
"# HubSpot-" 
