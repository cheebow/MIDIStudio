// "試聴" for the performance dialogs: plays the song (with the preview) from the start of the
// target notes and stops at their end, then returns to where the playhead was. The Transport stays
// the only clock; a frame loop just polls its position (as usePlaybackPosition does).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/store/context';

export function useAudition(): { playing: boolean; start: (startTick: number, endTick: number) => Promise<void>; stop: () => void } {
  const { transport, ensureAudio } = useServices();
  const [playing, setPlaying] = useState(false);
  const frame = useRef<number | null>(null);
  const before = useRef<{ tick: number; status: string } | null>(null);
  /** bumped by every start and stop: a start that was waiting for the audio when it changed gives up */
  const run = useRef(0);
  const stop = useCallback(() => {
    run.current++;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const b = before.current;
    before.current = null;
    if (!b) return;
    if (b.status === 'stopped') transport.stop();
    else if (transport.getState().status === 'playing') transport.pause();
    transport.seek(b.tick);
    setPlaying(false);
  }, [transport]);
  const start = useCallback(
    async (startTick: number, endTick: number) => {
      if (before.current) stop();
      const mine = ++run.current;
      const was = { tick: transport.getPosition().tick, status: transport.getState().status };
      before.current = was;
      await ensureAudio();
      if (run.current !== mine) return; // stopped (dialog closed) or restarted meanwhile
      await transport.play(startTick);
      if (run.current !== mine) {
        // stopped while the song was loading: stop() had nothing to undo yet, so put things back here
        if (!before.current) {
          if (was.status === 'stopped') transport.stop();
          else transport.pause();
          transport.seek(was.tick);
        }
        return;
      }
      setPlaying(true);
      const tick = () => {
        transport.poll();
        const p = transport.getPosition();
        if (transport.getState().status !== 'playing' || p.tick >= endTick || p.tick < startTick - 1) {
          stop();
          return;
        }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [transport, ensureAudio, stop],
  );
  useEffect(() => stop, [stop]);
  return { playing, start, stop };
}
