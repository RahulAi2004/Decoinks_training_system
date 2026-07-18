import { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken, getToken } from './api';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

function redirectToAuthentik() {
  if (!window.location.hostname.endsWith('.decoinkssuite.com')) return;
  const rd = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  window.location.replace(`${window.location.origin}/outpost.goauthentik.io/start?rd=${encodeURIComponent(rd)}`);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);   // undefined = loading

  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('auth-expired', onExpired);
    const sso = () => api('/auth/sso', { method: 'POST' })
      .then(({ token, user }) => { setToken(token); setUser(user); })
      .catch(() => {
        if (window.location.hostname.endsWith('.decoinkssuite.com')) redirectToAuthentik();
        else setUser(null);
      });
    if (!getToken()) sso();
    else api('/auth/me').then(setUser).catch(sso);
    return () => window.removeEventListener('auth-expired', onExpired);
  }, []);

  const login = async (email, password) => {
    const { token, user } = await api('/auth/login', { method: 'POST', body: { email, password } });
    setToken(token);
    setUser(user);
    return user;
  };
  const logout = () => { setToken(null); setUser(null); };

  return <AuthCtx.Provider value={{ user, login, logout }}>{children}</AuthCtx.Provider>;
}
