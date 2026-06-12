'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function AuthPage() {
  const { signIn, signUp, signOut, authed } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get('redirect') ?? '/arcade';

  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(null);
    if (!email.trim() || !password) { setErr('Enter an email and password.'); return; }
    setBusy(true);
    const { error } = mode === 'in'
      ? await signIn(email.trim(), password)
      : await signUp(email.trim(), password);
    setBusy(false);
    if (error) { setErr(error); return; }
    router.push(redirect);
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <h1 className="text-2xl font-bold mb-1">{mode === 'in' ? 'Log in' : 'Sign up'}</h1>
        <p className="text-sm text-zinc-400 mb-6">
          {mode === 'in' ? 'Welcome back.' : 'New players start with 1000 coins.'}
        </p>

        <label className="text-xs text-zinc-400">Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full mt-1 mb-3 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 outline-none"
          placeholder="you@example.com"
        />

        <label className="text-xs text-zinc-400">Password</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          className="w-full mt-1 mb-4 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 outline-none"
          placeholder="••••••••"
        />

        <button
          onClick={submit}
          disabled={busy}
          className="w-full px-4 py-2 rounded-lg bg-white text-black font-semibold disabled:opacity-60"
        >
          {busy ? 'Working…' : mode === 'in' ? 'Log in' : 'Create account'}
        </button>

        {err && <div className="text-sm text-red-400 mt-3">{err}</div>}

        <button
          onClick={() => { setErr(null); setMode(mode === 'in' ? 'up' : 'in'); }}
          className="w-full text-sm text-zinc-400 hover:text-white mt-4"
        >
          {mode === 'in' ? 'Need an account? Sign up' : 'Have an account? Log in'}
        </button>

        {authed && (
          <button
            onClick={async () => { await signOut(); }}
            className="w-full px-4 py-2 rounded-lg border border-zinc-800 text-sm mt-4"
          >
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
