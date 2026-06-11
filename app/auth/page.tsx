'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function AuthPage() {
  const { login, logout, authed } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get('redirect') ?? '/arcade';

  const doLogin = () => { login(); router.push(redirect); };
  const doLogout = () => { logout(); router.push('/'); };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <h1 className="text-2xl font-bold mb-2">Log in / Sign up</h1>
        <p className="text-sm text-zinc-400 mb-6">Auth placeholder. Swap to Supabase in Phase 2.</p>
        <button onClick={doLogin} className="w-full px-4 py-2 rounded-lg bg-white text-black font-semibold mb-2">Continue</button>
        {authed && <button onClick={doLogout} className="w-full px-4 py-2 rounded-lg border border-zinc-800 text-sm">Sign out</button>}
      </div>
    </div>
  );
}
