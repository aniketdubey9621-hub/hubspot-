import crypto from 'node:crypto';

/**
 * Encode Buffer to base64url (no padding).
 * @param {Buffer} buf
 */
function base64url(buf) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * @param {string} secret
 * @returns {{ raw: string, signed: string }}
 */
export function createSignedState(secret) {
  if (!secret || secret.length < 16) {
    throw new Error('HUBSPOT_STATE_SECRET must be set and at least 16 characters');
  }
  const payload = JSON.stringify({
    n: crypto.randomBytes(16).toString('hex'),
    t: Date.now(),
  });
  const payloadB64 = base64url(Buffer.from(payload, 'utf8'));
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  const sigB64 = base64url(sig);
  return { raw: payloadB64, signed: `${payloadB64}.${sigB64}` };
}

/**
 * Constant-time validation of signed state.
 * @param {string} secret
 * @param {string} stateFromQuery
 * @returns {boolean}
 */
export function validateSignedState(secret, stateFromQuery) {
  if (!stateFromQuery || typeof stateFromQuery !== 'string') return false;
  const dot = stateFromQuery.indexOf('.');
  if (dot <= 0) return false;
  const payloadB64 = stateFromQuery.slice(0, dot);
  const sigB64 = stateFromQuery.slice(dot + 1);
  if (!payloadB64 || !sigB64) return false;

  let sigBuf;
  try {
    sigBuf = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  } catch {
    return false;
  }

  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  if (sigBuf.length !== expected.length) return false;
  return crypto.timingSafeEqual(sigBuf, expected);
}
