import { useEffect, useRef, useState } from 'react';

export function useGameTimer() {
  const [started, setStarted] = useState(false);
  const [live, setLive] = useState('0.000000');
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!started) return;
    const tick = () => {
      if (!startTimeRef.current) return;
      setLive(((performance.now() - startTimeRef.current) / 1000).toFixed(6));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [started]);

  const start = () => {
    if (started) return;
    startTimeRef.current = performance.now();
    setStarted(true);
  };

  return { started, live, start };
}
