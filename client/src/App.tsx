import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiUrl, fetchJson } from './api';

type ConnectResponse = { authorizeUrl: string };
type ContactsResponse = {
  results: unknown[];
  paging: { next?: { after?: string } } | null;
};

function readQuery(): Record<string, string> {
  const q = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  q.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function humanizeError(err: { code: string; message: string; status?: number }): string {
  switch (err.code) {
    case 'not_connected':
      return 'Not connected: use “Connect HubSpot” first.';
    case 'refresh_failed':
      return 'Refresh failed: reconnect HubSpot or try again later.';
    case 'rate_limited':
      return 'Rate limited by HubSpot. Wait and retry.';
    case 'unauthorized':
      return 'HubSpot rejected the request after refresh.';
    default:
      return err.message || err.code;
  }
}

export function App() {
  const [banner, setBanner] = useState<string | null>(null);
  const [contactsJson, setContactsJson] = useState<string>('');
  const [loadingConnect, setLoadingConnect] = useState(false);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const devExpireUrl = useMemo(() => apiUrl('/dev/expire-token'), []);
  const devMetaUrl = useMemo(() => apiUrl('/dev/token-meta'), []);

  useEffect(() => {
    const q = readQuery();
    if (q.connected === '1') {
      setBanner('HubSpot connected. You can load contacts.');
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (q.oauth_error) {
      setBanner(`OAuth error: ${decodeURIComponent(q.oauth_error)}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const onConnect = useCallback(async () => {
    setLoadingConnect(true);
    setLastError(null);
    const r = await fetchJson<ConnectResponse>('/connect');
    setLoadingConnect(false);
    if (!r.ok) {
      setLastError(humanizeError(r.error));
      return;
    }
    window.location.href = r.data.authorizeUrl;
  }, []);

  const onContacts = useCallback(async () => {
    setLoadingContacts(true);
    setLastError(null);
    setContactsJson('');
    const r = await fetchJson<ContactsResponse>('/contacts');
    setLoadingContacts(false);
    if (!r.ok) {
      setLastError(humanizeError(r.error));
      return;
    }
    setContactsJson(JSON.stringify(r.data, null, 2));
  }, []);

  const onExpireDev = useCallback(async () => {
    setLastError(null);
    const res = await fetch(devExpireUrl, { method: 'POST' });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      setLastError(
        typeof (body as { error?: { message?: string } })?.error?.message === 'string'
          ? (body as { error: { message: string } }).error.message
          : 'Expire endpoint unavailable (enable DEV_ROUTES_ENABLED on server).',
      );
      return;
    }
    setContactsJson(JSON.stringify(body, null, 2));
  }, [devExpireUrl]);

  const onTokenMeta = useCallback(async () => {
    setLastError(null);
    const res = await fetch(devMetaUrl);
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    setContactsJson(JSON.stringify(body, null, 2));
  }, [devMetaUrl]);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16, maxWidth: 900 }}>
      <h1>HubSpot OAuth (assignment demo)</h1>
      {banner ? <p>{banner}</p> : null}
      {lastError ? (
        <p role="alert" style={{ color: '#a00' }}>
          {lastError}
        </p>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <button type="button" disabled={loadingConnect} onClick={() => void onConnect()}>
          {loadingConnect ? 'Loading…' : 'Connect HubSpot'}
        </button>
        <button type="button" disabled={loadingContacts} onClick={() => void onContacts()}>
          {loadingContacts ? 'Loading…' : 'Get Contacts'}
        </button>
        <button type="button" onClick={() => void onTokenMeta()}>
          Show token store (meta only)
        </button>
        <button type="button" onClick={() => void onExpireDev()}>
          Force expire access token (Loom)
        </button>
      </div>
      <p style={{ fontSize: 14, color: '#444' }}>
        “Show token store” / “Force expire” require <code>DEV_ROUTES_ENABLED=true</code> on the API. They never
        return token strings.
      </p>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f6f6f6', padding: 12 }}>{contactsJson || '—'}</pre>
    </div>
  );
}
