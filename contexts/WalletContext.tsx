'use client';
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getBalance, topUp as serviceTopUp } from '@/services/wallet.service';
import { useAuth } from './AuthContext';

type WalletContextValue = {
  balance: number;
  topUp: (amount: number) => void;
  refresh: () => void;
};

const WalletContext = createContext<WalletContextValue>({
  balance: 0, topUp: () => {}, refresh: () => {},
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { uid } = useAuth();
  const [balance, setBalance] = useState(0);

  const refresh = useCallback(() => {
    if (uid) setBalance(getBalance(uid));
  }, [uid]);

  useEffect(() => { refresh(); }, [refresh]);

  const topUp = (amount: number) => {
    if (!uid) return;
    setBalance(serviceTopUp(uid, amount));
  };

  return (
    <WalletContext.Provider value={{ balance, topUp, refresh }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() { return useContext(WalletContext); }
