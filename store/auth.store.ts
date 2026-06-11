import type { AuthState } from '@/types/auth';

const LS_AUTH = 'p4s_auth_v1';
const LS_UID = 'p4s_uid_v1';

export function getUID(): string {
  try {
    const existing = localStorage.getItem(LS_UID);
    if (existing) return existing;
    const fresh = 'U_' + Math.random().toString(36).slice(2, 10).toUpperCase();
    localStorage.setItem(LS_UID, fresh);
    return fresh;
  } catch {
    return 'U_GUEST';
  }
}

export function loadAuth(): AuthState {
  try {
    const json = localStorage.getItem(LS_AUTH);
    if (json) return JSON.parse(json);
  } catch {}
  return { authed: false, uid: getUID() };
}

export function saveAuth(a: AuthState): void {
  localStorage.setItem(LS_AUTH, JSON.stringify(a));
}
