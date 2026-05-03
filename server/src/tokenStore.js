/** @typedef {{ accessToken: string, refreshToken: string, expiresAt: number }} Tokens */

/** Single-connection demo store: one HubSpot connection. */
const CONNECTION_KEY = 'default';

/** @type {Map<string, Tokens>} */
const tokensByConnection = new Map();

/** @type {Map<string, Promise<void>>} */
const refreshInFlight = new Map();

export function getConnectionKey() {
  return CONNECTION_KEY;
}

/**
 * @param {string} connectionId
 * @returns {Tokens | undefined}
 */
export function getTokens(connectionId) {
  return tokensByConnection.get(connectionId);
}

/**
 * @param {string} connectionId
 * @param {Tokens} tokens
 */
export function setTokens(connectionId, tokens) {
  tokensByConnection.set(connectionId, { ...tokens });
}

/**
 * For Loom: force access token expiry without exposing the token.
 * @param {string} connectionId
 * @returns {boolean}
 */
export function forceExpireAccessToken(connectionId) {
  const t = tokensByConnection.get(connectionId);
  if (!t) return false;
  t.expiresAt = Date.now() - 1000;
  return true;
}

/**
 * Metadata only — safe for demos (no secrets).
 * @param {string} connectionId
 */
export function getTokenMeta(connectionId) {
  const t = tokensByConnection.get(connectionId);
  if (!t) {
    return { connected: false };
  }
  return {
    connected: true,
    expiresAt: t.expiresAt,
    refreshTokenPresent: Boolean(t.refreshToken),
  };
}

/**
 * Run refresh at most once per connection: concurrent callers share one Promise.
 * @param {string} connectionId
 * @param {() => Promise<void>} doRefresh
 */
export function runRefreshSingleFlight(connectionId, doRefresh) {
  let p = refreshInFlight.get(connectionId);
  if (!p) {
    p = doRefresh().finally(() => {
      refreshInFlight.delete(connectionId);
    });
    refreshInFlight.set(connectionId, p);
  }
  return p;
}
