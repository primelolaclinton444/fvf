'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { AuthState } from '@/types/auth';
import { loadAuth, saveAuth, getUID } from '@/store/auth.store';
import { initWallet } from '@/services/wallet.service';

type AuthContextValue = {
  authed: boolean;
  uid: string;
  login: () => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  authed: false, uid: '', login: () => {}, logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ authed: false, uid: '' });

  useEffect(() => {
    const a = loadAuth();
    initWallet(a.uid);
    setAuth(a);
  }, []);

  const login = () => {
    const uid = auth.uid || getUID();
    const next = { authed: true, uid };
    saveAuth(next);
    setAuth(next);
  };

  const logout = () => {
    const next = { authed: false, uid: getUID() };
    saveAuth(next);
    setAuth(next);
  };

  return (
    <AuthContext.Provider value={{ authed: auth.authed, uid: auth.uid, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
