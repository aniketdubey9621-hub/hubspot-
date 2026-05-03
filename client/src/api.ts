/**
 * - Dev: Vite proxies `/api/*` to the Node server.
 * - Prod same-origin (server serves `client/dist`): call API paths directly.
 * - Prod split hosts: set `VITE_API_BASE_URL` to the API origin (no trailing slash).
 */
export function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  if (base) return `${base}${p}`;
  if (import.meta.env.PROD) return p;
  return `/api${p}`;
}

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    status?: number;
  };
};

export async function fetchJson<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; error: ApiErrorBody['error']; status: number }> {
  const res = await fetch(apiUrl(path), { credentials: 'omit' });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    if (err?.code && err?.message) {
      return { ok: false, error: err, status: res.status };
    }
    return {
      ok: false,
      error: {
        code: 'http_error',
        message: res.statusText || `HTTP ${res.status}`,
        status: res.status,
      },
      status: res.status,
    };
  }
  return { ok: true, data: body as T };
}
