let token = localStorage.getItem('token') || null;

export function setToken(t) {
  token = t;
  if (t) localStorage.setItem('token', t);
  else localStorage.removeItem('token');
}
export function getToken() { return token; }

export async function api(path, { method = 'GET', body, formData } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    method, headers,
    body: formData ? formData : body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401) { setToken(null); window.dispatchEvent(new Event('auth-expired')); }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
