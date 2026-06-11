import { DEVELOPER_WALLET_UID, PROTOCOL_WALLET_UID } from '@/config/fees';

const LS_WALLETS = 'p4s_wallets_v1';

export function loadWallets(): Record<string, number> {
  try {
    const s = localStorage.getItem(LS_WALLETS);
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}

export function saveWallets(map: Record<string, number>): void {
  localStorage.setItem(LS_WALLETS, JSON.stringify(map));
}

export function getRawBalance(uid: string): number {
  return loadWallets()[uid] ?? 0;
}

export function setRawBalance(uid: string, amount: number): void {
  const w = loadWallets();
  w[uid] = amount;
  saveWallets(w);
}

export function seedStarterBalance(uid: string): void {
  const w = loadWallets();
  if (w[uid] === undefined) {
    w[uid] = 1000;
    saveWallets(w);
  }
  // Initialize fee wallets if not present
  if (w[DEVELOPER_WALLET_UID] === undefined) w[DEVELOPER_WALLET_UID] = 0;
  if (w[PROTOCOL_WALLET_UID] === undefined) w[PROTOCOL_WALLET_UID] = 0;
  saveWallets(w);
}
