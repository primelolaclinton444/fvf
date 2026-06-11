'use client';
import { useState } from 'react';

export function CopyableCode({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };
  return (
    <div className="w-full">
      <div className="text-xs text-zinc-400 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <input readOnly value={value} className="flex-1 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-sm" />
        <button onClick={onCopy} className="px-3 py-2 rounded-lg bg-white text-black text-sm font-semibold">{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}
