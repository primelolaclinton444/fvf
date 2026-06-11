'use client';
import { useAuth } from '@/contexts/AuthContext';
import { useWallet } from '@/contexts/WalletContext';
import Link from 'next/link';

export function Shell({ children, showBack, onBack }: { children: React.ReactNode; showBack?: boolean; onBack?: () => void }) {
  const { authed } = useAuth();
  const { balance, topUp } = useWallet();

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="px-4 py-6 border-b border-zinc-900">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href="/" className="text-2xl md:text-3xl font-extrabold tracking-tight">Play4Stakes</Link>
          {authed ? (
            <div className="flex items-center gap-3 text-sm">
              <div className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
                Balance: <span className="font-semibold">{balance}</span> coins
              </div>
              <button onClick={() => topUp(500)} className="px-3 py-1.5 rounded-lg bg-white text-black font-semibold">
                Top Up +500
              </button>
            </div>
          ) : (
            <Link href="/auth" className="text-sm text-zinc-400 hover:text-white">Sign in</Link>
          )}
        </div>
      </header>
      <main className="px-4 py-8">
        <div className="max-w-6xl mx-auto">{children}</div>
      </main>
      {showBack && (
        <div className="fixed left-4 bottom-4">
          <button onClick={onBack} className="px-3 py-2 rounded-lg border border-zinc-800 text-sm text-zinc-300 bg-zinc-950">← Back</button>
        </div>
      )}
    </div>
  );
}
