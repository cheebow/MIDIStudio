// React subscriptions to the Transport. Only components that use these hooks re-render on
// position updates (no whole-song re-render per animation frame).
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Transport, TransportPosition, TransportState } from '../../playback/Transport';

export function useTransportState(transport: Transport): TransportState {
  return useSyncExternalStore(
    (cb) => transport.subscribe(cb),
    () => transport.getState(),
  );
}

/** Playback position, re-read every animation frame while playing and on any transport change. */
export function usePlaybackPosition(transport: Transport): TransportPosition {
  const state = useTransportState(transport);
  const [, setFrame] = useState(0);
  useEffect(() => {
    if (state.status !== 'playing') return;
    let raf = requestAnimationFrame(function loop() {
      transport.poll();
      setFrame((f) => (f + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [transport, state.status]);
  return transport.getPosition();
}
