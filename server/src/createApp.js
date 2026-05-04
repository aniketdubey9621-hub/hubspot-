import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { createSignedState, validateSignedState } from './state.js';
import { logStructured } from './logger.js';
import {
  getConnectionKey,
  getTokens,
  setTokens,
  getTokenMeta,
  forceExpireAccessToken,
  runRefreshSingleFlight,
} from './tokenStore.js';
import { exchangeCodeForTokens, refreshAccessToken, fetchContactsPage } from './hubspot.js';

const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID || '';
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.HUBSPOT_REDIRECT_URI || '';
const STATE_SECRET = process.env.HUBSPOT_STATE_SECRET || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function stripEnvQuotes(s) {
  const t = String(s ?? '').trim();
  if (t.length >= 2) {
    const a = t[0];
    const b = t[t.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return t.slice(1, -1).trim();
    }
  }
  return t;
}

/** Override for EU portals: https://app-eu1.hubspot.com/oauth/authorize */
const HUBSPOT_AUTH_BASE =
  stripEnvQuotes(process.env.HUBSPOT_OAUTH_AUTHORIZE_URL) ||
  'https://app.hubspot.com/oauth/authorize';
/** HubSpot rejects the flow if this scope is not granted; always request it. */
const REQUIRED_HUBSPOT_SCOPE = 'crm.objects.contacts.read';

/**
 * @param {string | undefined} raw from HUBSPOT_SCOPES (spaces or commas between scopes)
 * @returns {{ list: string[], scopeString: string }}
 */
function buildRequiredScopes(raw) {
  const cleaned = stripEnvQuotes(raw);
  const ordered = [REQUIRED_HUBSPOT_SCOPE];
  const seen = new Set([REQUIRED_HUBSPOT_SCOPE]);
  for (const part of cleaned.split(/[\s,]+/)) {
    const s = part.trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      ordered.push(s);
    }
  }
  return { list: ordered, scopeString: ordered.join(' ') };
}

/**
 * Optional tiered scopes — HubSpot `optional_scope` param (see OAuth docs).
 * @param {string | undefined} raw
 * @returns {{ list: string[], scopeString: string }}
 */
function buildOptionalScopes(raw) {
  const cleaned = stripEnvQuotes(raw);
  if (!cleaned) return { list: [], scopeString: '' };
  const ordered = [];
  const seen = new Set();
  for (const part of cleaned.split(/[\s,]+/)) {
    const s = part.trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      ordered.push(s);
    }
  }
  return { list: ordered, scopeString: ordered.join(' ') };
}

const { list: SCOPES_LIST, scopeString: SCOPES } = buildRequiredScopes(process.env.HUBSPOT_SCOPES);
const OPTIONAL_SCOPES = buildOptionalScopes(process.env.HUBSPOT_OPTIONAL_SCOPES);

/**
 * HubSpot OAuth quickstart: encode query with encodeURIComponent (esp. scope uses %20 for spaces).
 * @param {{ clientId: string, redirectUri: string, scope: string, state: string, optionalScope?: string }} p
 */
function buildHubSpotAuthorizeUrl(p) {
  let url =
    HUBSPOT_AUTH_BASE +
    `?client_id=${encodeURIComponent(p.clientId)}` +
    `&redirect_uri=${encodeURIComponent(p.redirectUri)}` +
    `&scope=${encodeURIComponent(p.scope)}` +
    `&state=${encodeURIComponent(p.state)}`;
  if (p.optionalScope) {
    url += `&optional_scope=${encodeURIComponent(p.optionalScope)}`;
  }
  return url;
}

export async function createApp({
  routePrefix = '',
  enableStatic = false,
  clientDistPath: clientDistPathOpt,
} = {}) {
  const app = Fastify({ logger: false });

app.setErrorHandler((error, request, reply) => {
  logStructured('error', {
    event: 'unhandled_error',
    route: request.routeOptions?.url ?? request.url,
    partnerStatus: null,
    errName: error.name,
  });
  if (reply.sent) return;
  reply.status(500).send({
    error: {
      code: 'internal_error',
      message: 'An unexpected error occurred',
      status: 500,
    },
  });
});

await app.register(cors, {
  origin: true,
  credentials: true,
});

app.addHook('onResponse', (request, reply, done) => {
  const route = request.routeOptions?.url ?? request.url;
  const latencyMs = reply.elapsedTime ?? 0;
  const partnerStatus =
    request._hubspotPartnerStatus !== undefined
      ? request._hubspotPartnerStatus
      : null;
  logStructured('info', {
    event: 'http_request',
    route,
    method: request.method,
    statusCode: reply.statusCode,
    latencyMs: Math.round(latencyMs * 1000) / 1000,
    partnerStatus,
  });
  done();
});

  async function registerHttpRoutes(instance) {
instance.get('/health', async () => ({ ok: true }));

instance.get('/connect', async (request, reply) => {
  const started = Date.now();
  if (!CLIENT_ID || !REDIRECT_URI || !STATE_SECRET) {
    reply.status(503).send({
      error: {
        code: 'server_misconfigured',
        message: 'Missing HUBSPOT_CLIENT_ID, HUBSPOT_REDIRECT_URI, or HUBSPOT_STATE_SECRET',
      },
    });
    return;
  }
  let signed;
  try {
    signed = createSignedState(STATE_SECRET);
  } catch (e) {
    reply.status(500).send({
      error: { code: 'state_init_failed', message: 'Could not create OAuth state' },
    });
    return;
  }

  const authorizeUrl = buildHubSpotAuthorizeUrl({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scope: SCOPES,
    state: signed.signed,
    optionalScope: OPTIONAL_SCOPES.scopeString || undefined,
  });

  logStructured('info', {
    event: 'oauth_connect_ready',
    route: '/connect',
    latencyMs: Date.now() - started,
    partnerStatus: null,
    requestedScopes: SCOPES_LIST,
    optionalScopes: OPTIONAL_SCOPES.list,
    oauthHost: (() => {
      try {
        return new URL(HUBSPOT_AUTH_BASE).host;
      } catch {
        return null;
      }
    })(),
  });

  return {
    authorizeUrl,
    requestedScopes: SCOPES_LIST,
    ...(OPTIONAL_SCOPES.list.length ? { optionalScopes: OPTIONAL_SCOPES.list } : {}),
  };
});

instance.get('/callback', async (request, reply) => {
  const q = request.query;
  const code = typeof q.code === 'string' ? q.code : '';
  const state = typeof q.state === 'string' ? q.state : '';
  const err = typeof q.error === 'string' ? q.error : '';

  if (err) {
    const desc =
      typeof q.error_description === 'string'
        ? decodeURIComponent(q.error_description)
        : err;
    logStructured('warn', {
      event: 'oauth_callback_error_param',
      route: '/callback',
      partnerStatus: null,
    });
    return reply.redirect(`${FRONTEND_URL}/?oauth_error=${encodeURIComponent(desc)}`);
  }

  if (!STATE_SECRET || !validateSignedState(STATE_SECRET, state)) {
    logStructured('warn', {
      event: 'oauth_state_invalid',
      route: '/callback',
      partnerStatus: null,
    });
    return reply.redirect(
      `${FRONTEND_URL}/?oauth_error=${encodeURIComponent('invalid_or_expired_state')}`,
    );
  }

  if (!code || !CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    return reply.redirect(
      `${FRONTEND_URL}/?oauth_error=${encodeURIComponent('missing_code_or_server_config')}`,
    );
  }

  try {
    const tokens = await exchangeCodeForTokens({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
      code,
    });
    const conn = getConnectionKey();
    const existing = getTokens(conn);
    setTokens(conn, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || existing?.refreshToken || '',
      expiresAt: tokens.expiresAt,
    });
    logStructured('info', {
      event: 'oauth_tokens_stored',
      route: '/callback',
      partnerStatus: 200,
    });
  } catch (e) {
    logStructured('error', {
      event: 'oauth_token_exchange_failed',
      route: '/callback',
      partnerStatus: e.status ?? null,
    });
    return reply.redirect(
      `${FRONTEND_URL}/?oauth_error=${encodeURIComponent('token_exchange_failed')}`,
    );
  }

  return reply.redirect(`${FRONTEND_URL}/?connected=1`);
});

function cleanApiError(status, code, message) {
  return { error: { code, message, status } };
}

instance.get('/contacts', async (request, reply) => {
  const conn = getConnectionKey();
  const stored = getTokens(conn);
  if (!stored?.accessToken) {
    reply.status(401);
    return cleanApiError(401, 'not_connected', 'Connect HubSpot first');
  }

  const limit = Math.min(Math.max(Number(request.query.limit) || 25, 1), 100);
  const after = typeof request.query.after === 'string' ? request.query.after : undefined;

  const doHubSpotRequest = async (accessToken) => {
    const { status, json } = await fetchContactsPage({
      accessToken,
      limit,
      after,
    });
    request._hubspotPartnerStatus = status;
    return { status, json };
  };

  const performWithRefreshRetry = async () => {
    let accessToken = stored.accessToken;

    const tryOnce = async () => {
      const { status, json } = await doHubSpotRequest(accessToken);
      if (status === 401) return { needRefresh: true, json };
      if (status === 429) {
        reply.status(429);
        return {
          needRefresh: false,
          result: cleanApiError(429, 'rate_limited', 'HubSpot rate limit exceeded. Retry later.'),
        };
      }
      if (status >= 400) {
        reply.status(status);
        return {
          needRefresh: false,
          result: cleanApiError(
            status,
            'hubspot_error',
            typeof json?.message === 'string' ? json.message : 'HubSpot request failed',
          ),
        };
      }
      return {
        needRefresh: false,
        result: {
          results: json.results ?? [],
          paging: json.paging ?? null,
        },
      };
    };

    let r = await tryOnce();
    if (!r.needRefresh) return r.result;

    const latestForRefresh = getTokens(conn);
    if (!latestForRefresh?.refreshToken) {
      reply.status(401);
      return cleanApiError(
        401,
        'refresh_failed',
        'Access expired and no refresh token is available',
      );
    }

    logStructured('info', {
      event: 'hubspot_401_refresh_scheduled',
      route: '/contacts',
      partnerStatus: 401,
    });

    try {
      await runRefreshSingleFlight(conn, async () => {
        const current = getTokens(conn);
        if (!current?.refreshToken) {
          throw Object.assign(new Error('no_refresh_token'), { code: 'no_refresh_token' });
        }
        const refreshed = await refreshAccessToken({
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          refreshToken: current.refreshToken,
        });
        setTokens(conn, {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken || current.refreshToken,
          expiresAt: refreshed.expiresAt,
        });
        logStructured('info', {
          event: 'token_refresh_ok',
          route: '/contacts',
          partnerStatus: 200,
        });
      });
    } catch {
      logStructured('error', {
        event: 'token_refresh_failed',
        route: '/contacts',
        partnerStatus: null,
      });
      reply.status(401);
      return cleanApiError(401, 'refresh_failed', 'Could not refresh HubSpot session');
    }

    const updated = getTokens(conn);
    if (!updated?.accessToken) {
      reply.status(401);
      return cleanApiError(401, 'refresh_failed', 'Token missing after refresh');
    }
    accessToken = updated.accessToken;

    r = await tryOnce();
    if (r.needRefresh) {
      logStructured('warn', {
        event: 'hubspot_still_401_after_refresh',
        route: '/contacts',
        partnerStatus: 401,
      });
      reply.status(401);
      return cleanApiError(
        401,
        'unauthorized',
        'HubSpot rejected the request after a token refresh',
      );
    }
    return r.result;
  };

  return performWithRefreshRetry();
});

/** Loom: show token store shape without secrets */
instance.get('/dev/token-meta', async (_request, reply) => {
  if (process.env.DEV_ROUTES_ENABLED !== 'true') {
    reply.status(404);
    return { error: { code: 'not_found', message: 'Not found' } };
  }
  return getTokenMeta(getConnectionKey());
});

instance.post('/dev/expire-token', async (_request, reply) => {
  if (process.env.DEV_ROUTES_ENABLED !== 'true') {
    reply.status(404);
    return { error: { code: 'not_found', message: 'Not found' } };
  }
  const ok = forceExpireAccessToken(getConnectionKey());
  if (!ok) {
    reply.status(400);
    return { error: { code: 'not_connected', message: 'No tokens to expire' } };
  }
  logStructured('info', {
    event: 'dev_force_expire',
    route: '/dev/expire-token',
    partnerStatus: null,
  });
  return { ok: true, meta: getTokenMeta(getConnectionKey()) };
});

  }

  if (routePrefix) {
    await app.register(registerHttpRoutes, { prefix: routePrefix });
  } else {
    await app.register(registerHttpRoutes);
  }

  const CLIENT_DIST = clientDistPathOpt
    ? path.resolve(clientDistPathOpt)
    : path.resolve(process.env.CLIENT_DIST_PATH || path.join(__dirname, '../../client/dist'));

  if (enableStatic && fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: CLIENT_DIST,
      prefix: '/',
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== 'GET') {
        reply.status(404);
        return { error: { code: 'not_found', message: 'Not found' } };
      }
      const base = (request.url || '').split('?')[0];
      if (base.startsWith('/assets/')) {
        reply.status(404);
        return 'Not found';
      }
      return reply.sendFile('index.html');
    });
    logStructured('info', {
      event: 'static_spa_enabled',
      route: '_',
      latencyMs: 0,
      partnerStatus: null,
      dist: CLIENT_DIST,
    });
  } else if (enableStatic) {
    logStructured('warn', {
      event: 'static_dist_missing',
      route: '_',
      latencyMs: 0,
      partnerStatus: null,
      dist: CLIENT_DIST,
    });
  }

  return app;
}
