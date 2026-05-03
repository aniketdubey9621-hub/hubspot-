const TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';

/**
 * @param {Record<string, string>} params
 */
function formBody(params) {
  return new URLSearchParams(params).toString();
}

/**
 * @param {{ clientId: string, clientSecret: string, redirectUri: string, code: string }} cfg
 */
export async function exchangeCodeForTokens(cfg) {
  const body = formBody({
    grant_type: 'authorization_code',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    code: cfg.code,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error('token_exchange_failed');
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return normalizeTokenResponse(json);
}

/**
 * @param {{ clientId: string, clientSecret: string, refreshToken: string }} cfg
 */
export async function refreshAccessToken(cfg) {
  const body = formBody({
    grant_type: 'refresh_token',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error('refresh_failed');
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return normalizeTokenResponse(json);
}

function normalizeTokenResponse(json) {
  const accessToken = json.access_token;
  const refreshToken = typeof json.refresh_token === 'string' ? json.refresh_token : '';
  const expiresIn = Number(json.expires_in) || 1800;
  if (!accessToken) {
    const err = new Error('invalid_token_response');
    err.body = json;
    throw err;
  }
  const expiresAt = Date.now() + expiresIn * 1000;
  return {
    accessToken,
    refreshToken: refreshToken || '',
    expiresAt,
  };
}

/**
 * @param {{ accessToken: string, limit?: number, after?: string }} q
 */
export async function fetchContactsPage(q) {
  const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 100);
  const u = new URL('https://api.hubapi.com/crm/v3/objects/contacts');
  u.searchParams.set('limit', String(limit));
  if (q.after) u.searchParams.set('after', q.after);
  u.searchParams.set('properties', 'firstname,lastname,email');

  const res = await fetch(u.toString(), {
    headers: {
      Authorization: `Bearer ${q.accessToken}`,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text };
  }
  return { status: res.status, json };
}
