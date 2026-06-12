/**
 * Wallet — Phase 2.
 *
 * Reads come from the `wallets` row (RLS-gated: you only see your own).
 * Writes (debit/credit) are no longer done from the client — they happen inside
 * RPCs (`create_challenge`, `accept_challenge`, `settle_challenge`) as part of
 * the same transaction as the state change.
 *
 * Phase-1 imports of `escrowDebit` / `escrowCredit` are gone; this file keeps
 * `getBalance` and `initWallet` as thin Promises so the wallet context and any
 * legacy import sites keep compiling. Anything that still calls debit/credit is
 * a bug — the DB does that now.
 */
import { supabase } from '@/lib/supabase';

export async function getBalance(uid: string): Promise<number> {
  if (!uid) return 0;
  const { data, error } = await supabase
    .from('wallets')
    .select('balance')
    .eq('user_id', uid)
    .maybeSingle();
  if (error || !data) return 0;
  return Number(data.balance);
}

/** No-op in Phase 2 — the `handle_new_user` trigger seeds 1000 coins on signup. */
export function initWallet(_uid: string): void {
  /* server seeds via trigger; nothing to do here */
}
