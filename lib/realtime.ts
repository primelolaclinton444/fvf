/**
 * Realtime propagation layer.
 *
 * This is the ONLY file that knows *how* state updates travel between clients.
 * Today (Phase 1) it uses BroadcastChannel — instant, cross-tab — with a
 * `storage`-event fallback. The rest of the app talks to `publish` / `subscribe`
 * and never touches BroadcastChannel directly.
 *
 * SWAP SURFACE
 *   Phase 2: replace the bodies of publish/subscribe with Supabase Realtime
 *            channel.send / channel.on('broadcast'). No call sites change.
 *   Phase 3: subscribe to on-chain escrow contract events behind the same shape.
 *
 * LIMITATION (by design, Phase 1)
 *   BroadcastChannel and storage events are same-origin AND same-browser-profile.
 *   They do NOT cross devices or browser profiles. Real cross-device play needs
 *   the Phase 2 backend wired in behind this interface. UI copy reflects this.
 */

export type RealtimeTopic = 'challenge' | 'match';

/** Handler receives the changed code, or '*' when the source is a coarse signal. */
type Handler = (code: string) => void;

const CHANNEL_NAME = 'p4s_realtime_v1';

// Mirror of the localStorage keys so the storage-event fallback can map an
// event back to a topic. Kept here (not imported) to avoid a store→lib cycle.
const LS_KEYS: Record<RealtimeTopic, string> = {
  challenge: 'p4s_challenges_v3',
  match: 'p4s_connect4_match_states_v1',
};

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

/** Notify other clients that a topic/code changed. Call after every write. */
export function publish(topic: RealtimeTopic, code: string): void {
  try {
    getChannel()?.postMessage({ topic, code, at: Date.now() });
  } catch {
    /* no-op: realtime is best-effort, the 1s poll is the safety net */
  }
}

/**
 * Subscribe to updates for a topic. Fires `handler(code)` whenever ANOTHER
 * context changes that topic. Returns an unsubscribe function.
 *
 * Note: neither BroadcastChannel nor the storage event fires in the same context
 * that made the change — that context already re-reads its own state directly.
 */
export function subscribe(topic: RealtimeTopic, handler: Handler): () => void {
  if (typeof window === 'undefined') return () => {};

  const ch = getChannel();

  const onMessage = (ev: MessageEvent) => {
    const data = ev.data as { topic?: RealtimeTopic; code?: string } | null;
    if (data?.topic === topic && data.code) handler(data.code);
  };
  ch?.addEventListener('message', onMessage);

  // Fallback: storage events fire in other tabs of the same profile on write.
  const onStorage = (ev: StorageEvent) => {
    if (ev.key === LS_KEYS[topic]) handler('*');
  };
  window.addEventListener('storage', onStorage);

  return () => {
    ch?.removeEventListener('message', onMessage);
    window.removeEventListener('storage', onStorage);
  };
}

/** True when this code matches a change signal (handles the coarse '*' case). */
export function matchesCode(signal: string, code: string): boolean {
  return signal === '*' || signal.toUpperCase() === code.toUpperCase();
}
