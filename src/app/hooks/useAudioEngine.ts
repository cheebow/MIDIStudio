// Sound engine bootstrap (ADR-011 / 029): the standard SoundFont is downloaded in the background
// at startup, the engine starts on the first user gesture (browsers require one for audio), and
// MIDI input is requested once alongside it. The startup dialog (ADR-049) shows what still needs a click.
import { useEffect, useRef, useState } from 'react';
import type { SpessaAdapter, SoundBankReport } from '../../playback/SpessaAdapter';
import { DEFAULT_SOUNDFONT_URL, fetchSoundFont, soundBankSizeError } from '../../playback/SoundFontLoader';
import type { Transport } from '../../playback/Transport';
import type { MidiInputAdapter } from '../../input/MidiInputAdapter';
import { errorText } from '../errorText';
import { t } from '../../i18n';

export type AudioPhase = 'idle' | 'loading-soundfont' | 'ready';
export type MidiSetupState = 'unknown' | 'granted' | 'prompt' | 'denied' | 'unsupported';

const MIDI_PREF_KEY = 'midi-studio.midi';
const STARTUP_KEY = 'midi-studio.startup';

/**
 * The startup dialog (ADR-049) is shown at every start. The automated tests put 'skip' into
 * storage to bypass it (there is no user-facing switch: the click is needed for audio anyway).
 */
export function startupDialogWanted(): boolean {
  try {
    return localStorage.getItem(STARTUP_KEY) !== 'skip';
  } catch {
    return true;
  }
}

/** The user's answer to "use MIDI input?" (kept across visits; private mode may not keep it). */
export function midiPref(): 'use' | 'skip' | null {
  try {
    return (localStorage.getItem(MIDI_PREF_KEY) as 'use' | 'skip' | null) ?? null;
  } catch {
    return null;
  }
}
function saveMidiPref(v: 'use' | 'skip') {
  try {
    localStorage.setItem(MIDI_PREF_KEY, v);
  } catch {
    /* private mode: preference not kept */
  }
}

export function useAudioEngine({ adapter, transport, midi, blockers, setError }: { adapter: SpessaAdapter; transport: Transport; midi: MidiInputAdapter; blockers: string[]; setError: (m: string | null) => void }) {
  const [audioPhase, setAudioPhase] = useState<AudioPhase>('idle');
  const [progress, setProgress] = useState<number | null>(null);
  const [report, setReport] = useState<SoundBankReport | null>(null);
  const [soundBankName, setSoundBankName] = useState<string | null>(null);
  const [prefetchState, setPrefetchState] = useState<'loading' | 'done' | 'failed'>('loading');
  const [setup, setSetup] = useState<{ midi: MidiSetupState }>({ midi: 'unknown' });
  const prefetch = useRef<Promise<ArrayBuffer> | null>(null);
  const ensurePromise = useRef<Promise<void> | null>(null);
  /** while the startup dialog is open, the first gesture must not ask for MIDI (the user is choosing) */
  const midiHold = useRef(false);
  /** bytes of the bank the engine plays (for the offline WAV renderer, ADR-052) */
  const [soundBankBytes, setSoundBankBytes] = useState<ArrayBuffer | null>(null);

  /**
   * The most recent bank request wins (ADR-083): a local .sf2 picked while the standard bank is
   * still downloading must not be replaced when the download finishes. `bankGen` marks the latest
   * request, `bankQueue` keeps two engine loads from interleaving, `latestLoad` lets a superseded
   * request wait for the one that replaced it (so "audio ready" callers still get a ready engine).
   */
  const bankGen = useRef(0);
  const bankQueue = useRef<Promise<unknown>>(Promise.resolve());
  const latestLoad = useRef<Promise<void>>(Promise.resolve());

  /** `sizeBytes`: the file's size when known before reading it, so an oversized file is never read */
  function loadBank(load: () => Promise<ArrayBuffer>, name: string, sizeBytes?: number): Promise<void> {
    const tooBig = sizeBytes === undefined ? null : soundBankSizeError(sizeBytes);
    if (tooBig) {
      setError(tooBig); // the current bank stays loaded
      return Promise.resolve();
    }
    const gen = ++bankGen.current;
    const stale = () => gen !== bankGen.current;
    const run = async () => {
      setError(null);
      // a SoundFont (re)load must not leave the transport playing, but keeps the playhead where it is
      if (transport.getState().status === 'playing') transport.pause();
      setAudioPhase('loading-soundfont');
      try {
        await adapter.initialize();
        const buffer = await load();
        if (stale()) return latestLoad.current;
        const sizeError = soundBankSizeError(buffer.byteLength);
        if (sizeError) throw new Error(sizeError);
        // the engine transfers the buffer to its worklet (it is detached afterwards): keep a copy for the renderer
        const copy = buffer.slice(0);
        const loading = bankQueue.current.then(() => (stale() ? null : adapter.loadSoundBank(buffer)));
        bankQueue.current = loading.catch(() => undefined);
        const loaded = await loading;
        if (!loaded || stale()) return latestLoad.current;
        setReport(loaded);
        setSoundBankBytes(copy);
        setSoundBankName(name);
        setAudioPhase('ready');
      } catch (e) {
        if (stale()) return latestLoad.current;
        setError(errorText(e));
        setAudioPhase(adapter.isSoundBankLoaded ? 'ready' : 'idle');
      } finally {
        setProgress(null);
      }
    };
    const p = run();
    latestLoad.current = p;
    return p;
  }

  const startPrefetch = () => {
    setPrefetchState('loading');
    const p = fetchSoundFont(DEFAULT_SOUNDFONT_URL, setProgress);
    prefetch.current = p;
    p.then(
      () => setPrefetchState('done'),
      (e: unknown) => {
        setPrefetchState('failed');
        setError(t('{error} ファイル → 「SoundFont を選ぶ」でローカルの .sf2 も使えます。', { error: t(errorText(e)) }));
      },
    );
    return p;
  };

  /** Starts the engine with the standard SoundFont (call from a user gesture). Shared by every caller. */
  const ensureAudio = (): Promise<void> => {
    if (adapter.ready) return Promise.resolve();
    if (blockers.length > 0) return Promise.reject(new Error(blockers[0]));
    adapter.unlock(); // synchronous, inside the gesture (autoplay policy)
    if (!ensurePromise.current) {
      const buf = prefetch.current ?? startPrefetch();
      ensurePromise.current = loadBank(() => buf, 'GeneralUser GS v2.0.3').then(() => {
        ensurePromise.current = null;
        if (!adapter.ready) throw new Error(t('音源を準備できませんでした。'));
      });
      ensurePromise.current.catch(() => {
        ensurePromise.current = null;
        prefetch.current = null; // the buffer may be detached or failed: fetch again on retry
      });
    }
    return ensurePromise.current;
  };
  const ensureAudioRef = useRef(ensureAudio);
  useEffect(() => {
    ensureAudioRef.current = ensureAudio;
  });

  // Startup: try to start audio and MIDI input without asking; what needs a click goes into the
  // setup bar (one "開始" click does both).
  useEffect(() => {
    if (blockers.length > 0) return;
    void adapter.tryAutoStart().then((running) => {
      if (running) ensureAudioRef.current().catch(() => undefined);
    });
    void midi.permission().then((perm) => {
      setSetup((s) => ({ ...s, midi: perm }));
      if (perm === 'granted' && midiPref() !== 'skip') void midi.enable();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (blockers.length > 0) return;
    if (!prefetch.current) startPrefetch();
    const first = () => {
      window.removeEventListener('pointerdown', first, true);
      window.removeEventListener('keydown', first, true);
      ensureAudioRef.current().catch(() => undefined);
      // the first gesture also asks for MIDI input (once granted, later visits connect silently)
      if (!midiHold.current && midi.state !== 'granted' && midi.state !== 'unsupported' && midi.state !== 'requesting' && midiPref() !== 'skip') {
        void midi.enable().then(() => setSetup((st) => ({ ...st, midi: midi.state === 'granted' ? 'granted' : midi.state === 'denied' ? 'denied' : st.midi })));
      }
    };
    window.addEventListener('pointerdown', first, true);
    window.addEventListener('keydown', first, true);
    return () => {
      window.removeEventListener('pointerdown', first, true);
      window.removeEventListener('keydown', first, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startAll = (useMidi: boolean) => {
    ensureAudio().catch((e: unknown) => setError(errorText(e)));
    if (midi.state === 'unsupported') return;
    if (useMidi) {
      saveMidiPref('use');
      for (const d of midi.deviceList) midi.setDeviceEnabled(d.id, true); // undo an earlier "使わない"
      if (midi.state !== 'granted' || midi.deviceList.length === 0) void midi.enable().then(() => setSetup((s) => ({ ...s, midi: midi.state === 'granted' ? 'granted' : midi.state === 'denied' ? 'denied' : s.midi })));
    } else {
      saveMidiPref('skip');
      for (const d of midi.deviceList) midi.setDeviceEnabled(d.id, false);
    }
  };
  const setMidiHold = (hold: boolean) => {
    midiHold.current = hold;
  };

  return { audioPhase, progress, report, soundBankName, soundBankBytes, prefetchState, startPrefetch, ensureAudio, loadBank, setup, startAll, setMidiHold };
}
