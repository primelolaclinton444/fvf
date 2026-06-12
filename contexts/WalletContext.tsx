'use client';
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getBalance } from '@/services/wallet.service';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthContext';

type WalletContextValue = {
  balance: number;
  refresh: () => Promise<void>;
  /** Phase-1 had local top-ups; in Phase 2 the only inputs are signup grants
   *  and (later) crypto deposits. Kept as a no-op so old call sites compile. */
  topUp: (_amount: number) => void;
};

const WalletContext = createContext<WalletContextValue>({
  balance: 0,
  refresh: async () => {},
  topUp: () => {},
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { uid } = useAuth();
  const [balance, setBalance] = useState(0);

  const refresh = useCallback(async () => {
    if (!uid) { setBalance(0); return; }
    setBalance(await getBalance(uid));
  }, [uid]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Live balance: every challenge mutation re-credits / re-debits this row, so a
  // Postgres-changes subscription scoped to our user_id keeps the header honest.
  useEffect(() => {
    if (!uid) return;
    const channel = supabase
      .channel(`p4s:wallet:${uid}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'wallets', filter: `user_id=eq.${uid}` },
        (payload) => {
          const next = (payload.new as { balance: number | string } | null)?.balance;
          if (next != null) setBalance(Number(next));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [uid]);

  return (
    <WalletContext.Provider value={{ balance, refresh, topUp: () => {} }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() { return useContext(WalletContext); }
