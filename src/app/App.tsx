// MIDI Studio main window (UI_DESIGN 1). All editors share one EditorStore and one Transport.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { audioBlockers, detectFeatures } from '../playback/featureDetect';
import { SpessaAdapter } from '../playback/SpessaAdapter';
import { WORKLET_URL } from '../playback/SoundFontLoader';
import { Transport } from '../playback/Transport';
import { Metronome } from '../playback/Metronome';
import { openMidiFile } from '../core/project-io/midiFile';
import { exportSmfBytes } from '../core/project-io/exportSmf';
import { MAX_PROJECT_FILE_CHARS, parseProjectFile, serializeProject } from '../core/project-io/projectFile';
import { looseNoteCount, withoutLooseNotes } from '../core/model/looseNotes';
import { createStarterProject } from '../core/model/defaults';
import type { MidiProject } from '../core/model/types';
import { SMF_LIMITS, type ImportIssue } from '../core/smf/types';
import { addEvents, addTrack, channelInsertIndex, deleteClips, deleteEvents, duplicateEvents, duplicateTrack, moveEvents, removeTrack, mergeClips, splitClip, updateEvents } from '../core/editing/operations';
import { copyClips, copyEvents, duplicateClips, pasteClips, tracksRelativeTo, pasteEvents } from '../core/editing/clipboard';
import type { Command } from '../core/editing/history';
import type { Selection } from '../core/editing/selection';
import { quantizeNotes } from '../core/editing/quantize';
import { gridLabel, gridTicks, GRID_DIVISIONS } from '../core/timing/grid';
import { downloadBytes, safeFileName } from '../storage/files';
import { ProjectStore, StorageError, type ProjectSummary } from '../storage/indexedDb';
import { EditorStore } from './store/EditorStore';
import { EditActionsContext, ServicesContext, type AppActions, type AppServices } from './store/context';
import { useAudioEngine, startupDialogWanted } from './hooks/useAudioEngine';
import { StartupDialog, type StartupChoice } from './dialogs/StartupDialog';
import { SAMPLE_SONGS, sampleUrl } from './samples';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { buildMenus } from './menus';
import { AppDialogs, type DialogKind } from './dialogs/AppDialogs';
import { chordCandidatesAt } from '../core/guitar/chordContext';
import { sharedChords } from '../ui/hooks';
import { errorText } from './errorText';
import { TransportBar } from './TransportBar';
import { InputModeSwitch } from './InputModeSwitch';
import { useThemePref } from './theme';
import { useLocale } from '../i18n/react';
import { t } from '../i18n';
import { pianoRollZoomPatch } from '../ui/zoom';
import { MOD_LABEL } from '../ui/platform';
import { decodeShiftJis } from './textDecode';
import { MenuBar } from '../ui/menu/MenuBar';
import { Arrangement } from '../ui/arrangement/Arrangement';
import { PianoRoll } from '../ui/piano-roll/PianoRoll';
import { TrackInspector } from '../ui/inspector/TrackInspector';
import { Splitter } from '../ui/Splitter';
import { PencilIcon, SelectIcon, SnapGridIcon } from '../ui/icons';
import { DrumEditor } from '../ui/drum-editor/DrumEditor';
import { ListEditor } from '../ui/list-editor/ListEditor';
import { VisualMonitor } from '../ui/visual/VisualMonitor';
import { InputController } from '../input/InputController';
import { shiftOctave, type InputMode } from '../input/KeyboardRouter';
import { MidiInputAdapter, type MidiAccessLike } from '../input/MidiInputAdapter';
import { Recorder } from './recording/Recorder';
import { StepController } from './recording/StepController';
import { StepPanel } from '../ui/recording/StepPanel';
import { RecordControls } from '../ui/recording/RecordControls';
import { TempoEditor } from '../ui/tempo/TempoEditor';
import { Mixer } from '../ui/mixer/Mixer';
import { selectedTrack as currentTrack } from '../core/model/selectedTrack';


const db = new ProjectStore();
const AUTOSAVE_DELAY_MS = 1500;


/** two or more of the selected clips lie on the same track (merge is possible, ADR-065) */
function canMergeClips(clipIds: ReadonlySet<string>, project: MidiProject): boolean {
  const seen = new Set<string>();
  for (const c of project.clips) {
    if (!clipIds.has(c.id)) continue;
    if (seen.has(c.trackId)) return true;
    seen.add(c.trackId);
  }
  return false;
}

/** makes each "split at cursor" a fresh undo step (merge key) */
let splitCounter = 0;

export default function App() {
  const features = useMemo(() => detectFeatures(globalThis as never), []);
  const blockers = audioBlockers(features);
  const [info, setInfo] = useState<string | null>(null);
  const [, setMidiRev] = useState(0);
  // Engine objects are created once per page (useState initialiser) so that a hot module reload
  // in development or a re-render can never replace a running sound engine with a fresh one.
  const [svc] = useState(() => {
    const adapter = new SpessaAdapter(WORKLET_URL);
    const transport = new Transport(adapter);
    const store = new EditorStore(createStarterProject({ title: t('新しい曲') }));
    const input = new InputController(transport, () => store.project, store.project.inputPresets);
    const step = new StepController(store, input);
    const metronome = new Metronome(adapter, () => transport.playingMaps);
    const recorder = new Recorder(store, transport, input, (t, accent) => metronome.clickAt(t, accent), () => adapter.audioContext?.currentTime ?? null);
    const midi = new MidiInputAdapter(
      {
        onMessage: (m, dev, ts) => input.midiMessage(m, dev, ts),
        onDeviceLost: (dev, name) => {
          input.releaseSource(`midi:${dev}`);
          setInfo(t('MIDI 機器「{name}」が切断されました。鳴っていた音を止めました。', { name }));
        },
        onChange: () => setMidiRev((n) => n + 1),
      },
      typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function' ? (opts) => navigator.requestMIDIAccess(opts) as unknown as Promise<MidiAccessLike> : null,
    );
    return { adapter, transport, store, input, step, metronome, recorder, midi };
  });
  const { adapter, transport, store, input, step, metronome, recorder, midi } = svc;
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const inputState = useSyncExternalStore(input.subscribe, input.getSnapshot);
  const { project, selection, history, dirty } = state;
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  const [restore, setRestore] = useState<{ savedAt: string; json: string; title: string } | null>(null);
  const [showInspector, setShowInspector] = useState(true);
  const [tmOpen, setTmOpen] = useState(false);
  // the hidden <input type=file> elements, held in state (callback refs) so menus can click them
  const [midiInput, setMidiInput] = useState<HTMLInputElement | null>(null);
  const [projectInput, setProjectInput] = useState<HTMLInputElement | null>(null);
  const [sf2Input, setSf2Input] = useState<HTMLInputElement | null>(null);

  const recState = useSyncExternalStore(recorder.subscribe, recorder.getState);
  const theme = useThemePref();
  const lang = useLocale(); // the shell is keyed on it: a language change re-mounts the UI with the new texts

  // Transport follows committed content changes only (view settings do not reload the engine).
  useEffect(() => {
    void transport.setProject(store.project);
  }, [state.revision, store, transport]);

  useEffect(() => {
    if (project.settings.metronome) metronome.start();
    else metronome.stop();
    return () => metronome.stop();
  }, [project.settings.metronome, metronome]);

  useEffect(() => {
    input.setPresets(project.inputPresets);
  }, [input, project.inputPresets]);

  // Release preview notes on focus loss (REQ-PLAY-06 / INPUT_RECORDING 2).
  useEffect(() => {
    const release = () => {
      input.releaseAll();
      transport.releaseAllPreviews();
    };
    const onVis = () => document.hidden && release();
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [transport, input]);

  // Unsaved changes warning (REQ-PRJ-09, within browser limits).
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // Autosave (REQ-PRJ-08) and restore offer on startup (O02).
  useEffect(() => {
    void db
      .loadAutosave()
      .then((a) => a && setRestore({ savedAt: a.savedAt, json: a.json, title: a.title }))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    // Serializing a large song takes tens of ms on the main thread (docs/PERFORMANCE.md), so it
    // runs when the browser is idle; the timeout keeps it from being postponed forever.
    let idle: number | null = null;
    if (store.getState().previewBase) return; // a transform preview (ADR-077 / 092) is not content
    const save = () => {
      idle = null;
      const p = store.committedProject;
      db.saveAutosave({ id: p.id, title: p.title, savedAt: new Date().toISOString(), json: serializeProject(p) }).catch((e: unknown) => {
        setError(e instanceof StorageError ? t('自動保存できませんでした: {message}', { message: t(e.message) }) : String(e));
      });
    };
    const timer = setTimeout(() => {
      if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(save, { timeout: 2000 });
      else save();
    }, AUTOSAVE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      if (idle !== null) cancelIdleCallback(idle);
    };
  }, [state.revision, dirty, store]);
  // Best-effort flush when the page is hidden / closed, so the debounce above does not lose the last
  // seconds of edits (the beforeunload prompt still covers the case where the write cannot finish).
  useEffect(() => {
    const flush = () => {
      if (!store.getState().dirty) return;
      const p = store.committedProject;
      void db.saveAutosave({ id: p.id, title: p.title, savedAt: new Date().toISOString(), json: serializeProject(p) }).catch(() => undefined);
    };
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [store]);

  // ------------------------------------------------------------------ audio
  const audio = useAudioEngine({ adapter, transport, midi, blockers, setError });
  const { audioPhase, progress, report, soundBankName, soundBankBytes, prefetchState, startPrefetch, ensureAudio, loadBank, setup, startAll } = audio;
  // Startup dialog (ADR-049): song / sound / MIDI choices and the first gesture, in one place.
  const [startupOpen, setStartupOpen] = useState(() => startupDialogWanted());
  // about.html links to ./?help: open the help once the startup dialog is answered (or at once without it)
  const wantsHelp = useRef(typeof location !== 'undefined' && new URLSearchParams(location.search).has('help'));
  useEffect(() => {
    if (wantsHelp.current && !startupOpen) {
      wantsHelp.current = false;
      setDialog('help');
    }
  }, [startupOpen]);
  const showStartup = startupOpen && blockers.length === 0 && setup.midi !== 'unknown';
  useEffect(() => audio.setMidiHold(showStartup), [audio, showStartup]);
  const onStartup = (c: StartupChoice) => {
    setStartupOpen(false);
    startAll(c.useMidi);
    if (c.song === 'restore' && restore) {
      const r = parseProjectFile(restore.json);
      setRestore(null);
      if (r.ok) loadProject(r.project, { dirty: true, message: t('自動保存から復元しました。保存するまで「未保存」のままです。') });
      else setError(t('自動保存のデータを読み込めませんでした: {error}', { error: t(r.errors[0]) }));
    } else if (restore) {
      setRestore(null);
      void db.clearAutosave().catch(() => undefined);
    }
    if (c.song === 'sample' && c.sampleId) void openSample(c.sampleId);
  };

  // ------------------------------------------------------------------ file actions
  const guardDirty = (then: () => void) => {
    if (store.getState().dirty) setDialog({ confirm: t('保存されていない変更があります。破棄して続けますか？'), onYes: then });
    else then();
  };

  function loadProject(p: MidiProject, opts: { dirty?: boolean; message?: string } = {}) {
    transport.stop();
    store.load(p, { dirty: opts.dirty });
    setRestore(null); // the restore offer is only for the song that was there at startup
    if (opts.message) setInfo(opts.message);
  }

  // Reading a file or the browser storage can fail (file moved, permission, quota...): show it
  // instead of losing the rejection in a `void` call (ADR-084).
  const readFailed = (name: string, e: unknown) => setError(t('{name} を開けませんでした（現在の曲はそのままです）: {errors}', { name, errors: t(errorText(e)) }));

  async function importMidi(file: File) {
    // checked before reading: a huge file would be read into memory first (ADR-087)
    if (file.size > SMF_LIMITS.maxBytes) {
      setError(t('{name} を開けませんでした（現在の曲はそのままです）: {errors}', { name: file.name, errors: t('MIDI ファイルが大きすぎます（{bytes} バイト、上限 {maxMiB} MiB）。', { bytes: file.size, maxMiB: SMF_LIMITS.maxBytes / 1024 / 1024 }) }));
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (e) {
      readFailed(file.name, e);
      return;
    }
    importMidiBytes(bytes, file.name);
  }

  /** SMF bytes from a file or a bundled sample; `title` replaces an untitled song's name. */
  function importMidiBytes(bytes: Uint8Array, name: string, opts: { title?: string; silentIssues?: boolean } = {}) {
    const r = openMidiFile(bytes, { decodeText: decodeShiftJis });
    if (!r.ok) {
      setError(t('{name} を開けませんでした（現在の曲はそのままです）: {errors}', { name, errors: r.errors.map((e) => t(e.message)).join(' / ') }));
      return;
    }
    const project = opts.title && (r.project.title === '無題' || r.project.title === t('無題')) ? { ...r.project, title: opts.title } : r.project; // the import's default title, in either language
    loadProject(project, { message: t('{name} を読み込みました（PPQ {ppq}、{n} トラック）。', { name, ppq: project.ppq, n: project.tracks.length }) });
    setIssues(r.issues);
    if (!opts.silentIssues && r.issues.some((i) => i.severity !== 'info')) setDialog('issues');
  }

  /** Opens a bundled sample song (ADR-058). Its import notes stay in ツール › 読み込み時の注意 rather than popping up. */
  async function openSample(id: string) {
    const song = SAMPLE_SONGS.find((s) => s.id === id);
    if (!song) return;
    try {
      const res = await fetch(sampleUrl(song));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      importMidiBytes(new Uint8Array(await res.arrayBuffer()), song.title, { title: song.title, silentIssues: true });
    } catch (e) {
      setError(t('サンプル曲「{title}」を読み込めませんでした: {error}', { title: song.title, error: t(errorText(e)) }));
    }
  }

  async function openProject(file: File) {
    if (file.size > MAX_PROJECT_FILE_CHARS) {
      setError(t('{name} を開けませんでした（現在の曲はそのままです）: {errors}', { name: file.name, errors: t('プロジェクトファイルが大きすぎます。') }));
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch (e) {
      readFailed(file.name, e);
      return;
    }
    const r = parseProjectFile(text);
    if (!r.ok) {
      setError(t('{name} を開けませんでした（現在の曲はそのままです）: {errors}', { name: file.name, errors: r.errors.slice(0, 5).map((m) => t(m)).join(' / ') }));
      return;
    }
    setIssues([]);
    loadProject(r.project, { message: t('{name} を開きました。', { name: file.name }) });
  }

  async function saveToBrowser() {
    const p = store.project;
    const rev = store.getState().revision;
    try {
      await db.saveProject({ id: p.id, title: p.title, savedAt: new Date().toISOString(), json: serializeProject(p) });
      // an edit made while saving is not in the saved copy: it stays unsaved, and so does its autosave (ADR-087)
      if (store.getState().revision === rev) {
        store.markSaved();
        await db.clearAutosave().catch(() => undefined);
      }
      setInfo(t('「{title}」をブラウザ内に保存しました。', { title: p.title }));
    } catch (e) {
      setError(e instanceof StorageError ? e.message : String(e));
    }
  }

  function saveAsFile() {
    const p = store.project;
    downloadBytes(serializeProject(p, { savedAt: new Date().toISOString(), pretty: true }), safeFileName(p.title, 'midstudio'), 'application/json');
    store.markSaved();
  }

  function exportMidi() {
    const p = store.project;
    const loose = looseNoteCount(p);
    const { bytes, warnings } = exportSmfBytes(withoutLooseNotes(p)); // what you hear is what you get (ADR-064)
    downloadBytes(bytes, safeFileName(p.title, 'mid'), 'audio/midi');
    const notes = [...warnings.map((w) => t(w.message)), ...(loose ? [t('クリップの外にあるノート {n} 個は鳴らないので含めていません', { n: loose })] : [])];
    setInfo(notes.length ? t('MIDI（SMF Format 1, PPQ {ppq}）を書き出しました。注意: {list}', { ppq: p.ppq, list: notes.join(' / ') }) : t('MIDI（SMF Format 1, PPQ {ppq}）を書き出しました。', { ppq: p.ppq }));
  }

  // the hidden <input type=file> elements are clicked from menus / shortcuts
  function openProjectFile() {
    guardDirty(() => projectInput?.click());
  }
  function importMidiFile() {
    guardDirty(() => midiInput?.click());
  }
  function openSampleSong(id: string) {
    guardDirty(() => void openSample(id));
  }
  function chooseSoundFont() {
    sf2Input?.click();
  }

  async function showRecent() {
    try {
      setRecent(await db.listProjects());
      setDialog('recent');
    } catch (e) {
      setError(e instanceof StorageError ? e.message : String(e));
    }
  }

  async function openRecent(id: string) {
    let rec: Awaited<ReturnType<typeof db.loadProject>>;
    try {
      rec = await db.loadProject(id);
    } catch (e) {
      setError(t('ブラウザに保存した曲を読み込めませんでした: {error}', { error: t(errorText(e)) }));
      return;
    }
    if (!rec) {
      setError(t('ブラウザに保存した曲が見つかりませんでした（別のタブで削除された可能性があります）。'));
      return;
    }
    const r = parseProjectFile(rec.json);
    if (!r.ok) {
      setError(t('保存データが壊れています（現在の曲はそのままです）: {errors}', { errors: r.errors.slice(0, 3).map((m) => t(m)).join(' / ') }));
      return;
    }
    setDialog(null);
    loadProject(r.project, { message: t('「{title}」を開きました。', { title: rec.title }) });
  }

  // ------------------------------------------------------------------ edit actions
  const selectedTrack = currentTrack(project);
  const selectedIds = [...selection.eventIds];
  const grid = gridTicks(project.ppq, project.settings.grid);
  const gridInt = Math.max(1, Math.round(grid.num / grid.den));
  const tryRun = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const clipsOnly = (sel: Selection) => sel.eventIds.size === 0 && sel.clipIds.size > 0;
  const runSelectingClips = (command: Command, clipIds: string[]) => {
    store.run(command);
    store.setSelection({ ...store.getState().selection, eventIds: new Set(), clipIds: new Set(clipIds) });
  };
  const actions: AppActions = {
    undo: () => store.undo(),
    redo: () => store.redo(),
    // Copy / cut / paste / duplicate / delete act on the selected notes, or, when only clips
    // (regions) are selected in the track view, on those clips as a group (ADR-057).
    // ⌘C / ⌘X with nothing selected keep the clipboard as it is (ADR-084)
    copy: () => {
      const sel = store.getState().selection;
      const data = clipsOnly(sel) ? copyClips(store.project, sel.clipIds) : copyEvents(store.project, sel.eventIds);
      if (data) store.setClipboard(data);
    },
    cut: () => {
      const sel = store.getState().selection;
      if (clipsOnly(sel)) {
        const data = copyClips(store.project, sel.clipIds);
        if (!data) return;
        store.setClipboard(data);
        store.run(deleteClips(store.project, sel.clipIds, { deleteEvents: true }, '切り取り'));
        return;
      }
      const data = copyEvents(store.project, sel.eventIds);
      if (!data) return;
      store.setClipboard(data);
      store.run(deleteEvents(store.project, sel.eventIds, '切り取り'));
    },
    paste: () =>
      tryRun(() => {
        const clip = store.getState().clipboard;
        const trk = currentTrack(store.project);
        if (!clip || !trk) return;
        const tick = Math.round(transport.getPosition().tick);
        if (clip.clips) {
          // the topmost copied clip lands on the selected track, the others keep their relative lanes (ADR-062)
          const r = pasteClips(store.project, tick, clip, tracksRelativeTo(store.project, clip, trk.id));
          if (r) runSelectingClips(r.command, r.clipIds);
          return;
        }
        const r = pasteEvents(store.project, trk.id, tick, clip);
        if (r) store.run(r.command, { select: r.ids });
      }),
    duplicate: () =>
      tryRun(() => {
        const sel = store.getState().selection;
        if (clipsOnly(sel)) {
          const r = duplicateClips(store.project, sel.clipIds);
          if (r) runSelectingClips(r.command, r.clipIds);
          return;
        }
        const clip = copyEvents(store.project, sel.eventIds);
        if (!clip) return;
        const r = duplicateEvents(store.project, sel.eventIds, clip.span);
        if (r) store.run(r.command, { select: r.ids });
      }),
    delete: () => {
      const sel = store.getState().selection;
      if (!clipsOnly(sel)) return store.run(deleteEvents(store.project, sel.eventIds));
      // nothing but clips selected (arrangement view): delete the regions with their notes, one undo step
      tryRun(() => {
        store.run(deleteClips(store.project, sel.clipIds, { deleteEvents: true }));
        store.setSelection({ ...store.getState().selection, clipIds: new Set() });
      });
    },
    selectAll: () => selectedTrack && store.selectEvents(selectedTrack.events.filter((e) => e.kind === 'note').map((e) => e.id)),
    quantize: () =>
      tryRun(() => {
        try {
          store.run(quantizeNotes(store.project, store.getState().selection.eventIds, { grid }));
        } catch (e) {
          setDialog({ confirm: `${t((e as Error).message)}\n${t('丸めて実行しますか？')}`, onYes: () => store.run(quantizeNotes(store.project, store.getState().selection.eventIds, { grid, allowRounding: true })) });
        }
      }),
    quantizeDialog: () => setDialog('quantize'),
    humanizeDialog: () => setDialog('humanize'),
    velocityDialog: () => setDialog('velocity'),
    performDialog: (kind) => setDialog({ perform: kind }),
    guitarVoicing: ({ trackId, tick, returnFocus }) => {
      // the analysis is read here, at the right-click, and only while the chord names are shown (ADR-091)
      const p = store.project;
      const candidates = p.settings.showChords ? chordCandidatesAt(sharedChords(p), tick) : [];
      setDialog({ guitar: { trackId, tick: Math.max(0, Math.round(tick)), candidates, returnFocus } });
    },
    guitarProgression: ({ trackId, tick, returnFocus }) => {
      const p = store.project;
      setDialog({ progression: { trackId, tick: Math.max(0, Math.round(tick)), loop: { startTick: p.loop.startTick, endTick: p.loop.endTick }, chords: p.settings.showChords ? sharedChords(p) : [], returnFocus } });
    },
    transpose: (d: number) => tryRun(() => store.run(moveEvents(store.project, store.getState().selection.eventIds, 0, d, '移調'))),
    noteLength: () =>
      tryRun(() =>
        store.run(
          updateEvents(
            store.project,
            [...store.getState().selection.eventIds].filter((id) => store.project.tracks.some((t) => t.events.some((e) => e.id === id && e.kind === 'note'))).map((id) => ({ id, changes: { durationTicks: gridInt } })),
            'ノートの長さを揃える',
          ),
        ),
      ),
    mergeClips: () =>
      tryRun(() => {
        const ids = [...store.getState().selection.clipIds];
        const r = mergeClips(store.project, ids);
        if (!r) return;
        store.run(r);
        // the surviving clips stay selected
        const alive = new Set(store.project.clips.map((c) => c.id));
        store.setSelection({ ...store.getState().selection, clipIds: new Set(ids.filter((id) => alive.has(id))) });
      }),
    splitAtCursor: () =>
      tryRun(() => {
        const tick = Math.round(transport.getPosition().tick);
        const ids = [...store.getState().selection.clipIds];
        const targets = ids.length ? ids : store.project.clips.filter((c) => c.trackId === selectedTrack?.id && tick > c.startTick && tick < c.endTick).map((c) => c.id);
        // several clips split at once are one undo step (ADR-084)
        const mergeKey = `split-${++splitCounter}`;
        for (const id of targets) store.run(splitClip(store.project, id, tick), { mergeKey });
      }),
    addTrack: () => {
      const used = new Set(store.project.tracks.filter((t) => t.port === 'A').map((t) => t.channel));
      const channel = [...Array(16).keys()].find((c) => c !== 9 && !used.has(c)) ?? 0;
      const r = addTrack(store.project, { name: `Track ${store.project.tracks.length + 1}`, channel }, channelInsertIndex(store.project, 'A', channel));
      // a new track starts with a piano Program Change (one undo step together with the track)
      const after = { ...store.project, ...r.command.patch };
      const pc = addEvents(after, r.trackId, [{ kind: 'program', tick: 0, program: 0 }], { label: 'トラックを追加' });
      store.run(pc ? { label: 'トラックを追加', patch: { ...r.command.patch, ...pc.command.patch } } : r.command);
      store.updateSettings({ selectedTrackId: r.trackId });
    },
    duplicateTrack: () => selectedTrack && store.run(duplicateTrack(store.project, selectedTrack.id).command),
    removeTrack: () => selectedTrack && store.run(removeTrack(store.project, selectedTrack.id)),
  };

  useGlobalShortcuts({ store, transport, input, step, recorder, actions, ensureAudio, saveToBrowser: () => void saveToBrowser(), openProjectFile, toggleVisual: () => setTmOpen((v) => !v), setError, tryRun,
    openHelp: () => setDialog('help'),
  });

  const services: AppServices = { store, transport, adapter, input, step, recorder, audioReady: audioPhase === 'ready', ensureAudio, reportError: setError };
  const setMode = (m: InputMode) => input.setMode(m);
  const MODE_LABEL: Record<InputMode, string> = { 'edit-shortcuts': t('編集（ショートカット）'), 'piano-performance': t('PC 鍵盤'), 'drum-performance': t('ドラムパッド'), 'step-piano': t('ステップ（鍵盤）'), 'step-drums': t('ステップ（ドラム）') };
  const stepMode = inputState.mode === 'step-piano' || inputState.mode === 'step-drums';
  const noSel = selectedIds.length === 0;
  const settings = project.settings;

  const menus = buildMenus({
    project,
    history,
    clipboard: state.clipboard,
    hasSelection: !noSel,
    hasClipSelection: selection.clipIds.size > 0,
    canMergeClips: canMergeClips(state.selection.clipIds, project),
    selectedTrack,
    inputMode: inputState.mode,
    sustain: input.sustain,
    recording: recState.phase !== 'idle',
    showInspector,
    visualOpen: tmOpen,
    theme,
    actions,
    store,
    transport,
    input,
    recorder,
    ensureAudio,
    setError,
    setInfo,
    setDialog,
    setMode,
    tryRun,
    audioReady: audioPhase === 'ready',
    file: {
      newProject: () => guardDirty(() => loadProject(createStarterProject({ title: t('新しい曲') }))),
      openProject: openProjectFile,
      openRecent: () => guardDirty(() => void showRecent()),
      saveToBrowser: () => void saveToBrowser(),
      saveAsFile,
      importMidi: importMidiFile,
      openSample: openSampleSong,
      exportMidi,
      chooseSoundFont,
    },
    setShowInspector,
    setVisualOpen: setTmOpen,
  });

  const tabs: { id: MidiProject['settings']['activePanel']; label: string }[] = [
    { id: 'piano-roll', label: t('ピアノロール') },
    { id: 'drum', label: t('ドラム') },
    { id: 'list', label: t('リスト') },
    { id: 'mixer', label: t('ミキサー') },
    { id: 'tempo', label: t('コンダクター') },
  ];

  return (
    <ServicesContext.Provider value={services}>
      <EditActionsContext.Provider value={actions}>
      <div className="shell" key={lang}>
        <MenuBar menus={menus} />
        <header className="toolbar">
          <TransportBar
            transport={transport}
            project={project}
            audioReady={audioPhase === 'ready'}
            ensureAudio={ensureAudio}
            metronome={settings.metronome}
            onMetronomeChange={(on) => store.updateSettings({ metronome: on })}
            onLoopChange={(loop) => store.setLoop(loop)}
            onError={setError}
            record={<RecordControls recorder={recorder} beforeStart={ensureAudio} onSettings={() => setDialog('record')} onError={setError} onMessage={setInfo} />}
          />
        </header>
        <div className="toolbar toolbar-sub" role="toolbar" aria-label={t('入力と表示')}>
          <div className="toolbar-group">
            <span className="note">{t('入力')}</span>
            <InputModeSwitch mode={inputState.mode} setMode={setMode} drumTrack={selectedTrack?.displayMode === 'drum'} />
            {/* always rendered (disabled outside the PC-keyboard mode) so the toolbar never shifts */}
            <span className="segmented" role="group" aria-label={t('PC 鍵盤')}>
              <button disabled={inputState.mode !== 'piano-performance'} onClick={() => store.setInputPresets(shiftOctave(project.inputPresets, -1))} aria-label={t('オクターブを下げる')} title={t('PC 鍵盤のオクターブを下げる（鍵盤モードのとき。↓ キーでも）')}>
                Oct−<kbd className="mode-key">↓</kbd>
              </button>
              <button disabled={inputState.mode !== 'piano-performance'} onClick={() => store.setInputPresets(shiftOctave(project.inputPresets, 1))} aria-label={t('オクターブを上げる')} title={t('PC 鍵盤のオクターブを上げる（鍵盤モードのとき。↑ キーでも）')}>
                Oct+<kbd className="mode-key">↑</kbd>
              </button>
              <button disabled={inputState.mode !== 'piano-performance'} className={input.sustain ? 'on' : ''} aria-pressed={input.sustain} onClick={() => input.setSustain(!input.sustain)} title={t('サステイン（CC64、鍵盤モードのとき）。このボタンは押すたびに切り替え、Tab キーは押している間だけ')}>
                Sus<kbd className="mode-key">Tab</kbd>
              </button>
            </span>
          </div>
          <div className="toolbar-group">
            {blockers.length > 0 ? (
              <span className="error-text">{blockers[0]}</span>
            ) : audioPhase === 'ready' ? (
              <span className="note audio-ok" data-testid="audio-status" title={t('音源: {name}{detail}', { name: soundBankName ?? '', detail: report ? t('（プリセット {n} 個{missing}）', { n: report.presetCount, missing: report.missingPrograms.length > 0 ? t('、GM で不足 {m} 音色', { m: report.missingPrograms.length }) : '' }) : '' })}>
                {t('音源 ✓')}<span className="sr-only">{soundBankName}</span>
              </span>
            ) : prefetchState === 'failed' ? (
              <button className="primary" onClick={() => (startPrefetch(), void ensureAudio().catch(() => undefined))} data-testid="start-audio">
                {t('音源を再読み込み')}
              </button>
            ) : (
              <span className="note" data-testid="audio-loading">
                {prefetchState === 'loading' || audioPhase === 'loading-soundfont'
                  ? t('音源: 読み込み中 {pct}', { pct: progress === null ? '' : `${Math.round(progress * 100)}%` })
                  : t('音源: 準備完了')}
              </span>
            )}
            <span className="sep" />
            <button onClick={() => setTmOpen(true)} title={t('ビジュアルモード: レコンポーザ風リスト / 全トラックのピアノロール / 鍵盤で演奏を表示（T）')} data-testid="open-tm">
              {t('ビジュアル')}
            </button>
          </div>
        </div>

        {restore && !showStartup && (
          <div className="banner" role="status">
            {t('前回の自動保存「{title}」（{date}）があります。', { title: restore.title, date: new Date(restore.savedAt).toLocaleString() })}
            <button
              onClick={() =>
                // replacing an edited song needs the same confirmation as File › 新規 / 開く
                guardDirty(() => {
                  const r = parseProjectFile(restore.json);
                  setRestore(null);
                  if (r.ok) loadProject(r.project, { dirty: true, message: t('自動保存から復元しました。保存するまで「未保存」のままです。') });
                  else setError(t('自動保存のデータを読み込めませんでした: {error}', { error: t(r.errors[0]) }));
                })
              }
            >
              {t('復元')}
            </button>
            <button onClick={() => (setRestore(null), void db.clearAutosave().catch(() => undefined))}>{t('破棄')}</button>
          </div>
        )}
        {error && (
          <div className="banner error" role="alert" data-testid="error">
            {error}
            <button onClick={() => setError(null)}>{t('閉じる')}</button>
          </div>
        )}

        <div className="workspace">
          <Arrangement />
          {showInspector && <TrackInspector />}
        </div>

        {!settings.editorCollapsed && (
          <Splitter
            label={t('下部エディターの高さ')}
            height={Math.min(settings.editorHeight ?? Math.round(window.innerHeight * 0.55), Math.max(200, window.innerHeight - 220))}
            min={160}
            max={Math.max(200, window.innerHeight - 220)}
            onResize={(h) => store.updateSettings({ editorHeight: h })}
            onToggle={() => store.updateSettings({ editorCollapsed: true })}
          />
        )}
        <section
          className={`editor-panel${settings.editorCollapsed ? ' collapsed' : ''}`}
          aria-label={t('エディター')}
          // the saved height, but it gives way (down to 160px) when the window is shorter than the one it
          // was set on, so the status bar is never pushed off the page (ADR-087)
          style={settings.editorCollapsed ? undefined : settings.editorHeight ? { flex: '0 1 auto', height: settings.editorHeight, minHeight: 160 } : undefined}
        >
          <div className="tabs" role="tablist">
            {tabs.map((tab) => (
              <button key={tab.id} role="tab" aria-selected={settings.activePanel === tab.id} className={settings.activePanel === tab.id ? 'on' : ''} onClick={() => store.updateSettings({ activePanel: tab.id, editorCollapsed: false })}>
                {tab.label}
              </button>
            ))}
            {!settings.editorCollapsed && (settings.activePanel === 'piano-roll' || settings.activePanel === 'drum') && (
              <span className="editor-tools">
                <span className="segmented" role="group" aria-label={t('ツール')}>
                  <button aria-label={t('選択')} aria-pressed={state.tool === 'select'} className={`icon-btn${state.tool === 'select' ? ' on' : ''}`} onClick={() => store.setTool('select')} title={t('選択ツール (V): クリックで選択、ドラッグで移動・範囲選択')} data-testid="tool-select">
                    <SelectIcon />
                  </button>
                  <button aria-label={t('描画')} aria-pressed={state.tool === 'draw'} className={`icon-btn${state.tool === 'draw' ? ' on' : ''}`} onClick={() => store.setTool('draw')} title={t('描画ツール (P): クリックで入力（ドラムではもう一度クリックで削除）')} data-testid="tool-draw">
                    <PencilIcon />
                  </button>
                </span>
                <label className="icon-toggle" title={t('スナップ（グリッドに合わせる）。Ctrl / ⌘ を押しながらのドラッグで一時的に無効')}>
                  <input type="checkbox" aria-label="SNAP" checked={settings.snapEnabled} onChange={(e) => store.updateSettings({ snapEnabled: e.target.checked })} />
                  <SnapGridIcon />
                  <span className="icon-text">{t('スナップ')}</span>
                </label>
                <select
                  aria-label={t('グリッド')}
                  value={`${settings.grid.division}:${settings.grid.kind}`}
                  onChange={(e) => {
                    const [d, k] = e.target.value.split(':');
                    store.updateSettings({ grid: { division: Number(d), kind: k as 'straight' | 'triplet' | 'dotted' } });
                  }}
                >
                  {GRID_DIVISIONS.flatMap((d) => (['straight', 'triplet', 'dotted'] as const).map((k) => ({ division: d, kind: k }))).map((g) => {
                    const gt = gridTicks(project.ppq, g);
                    return (
                      <option key={`${g.division}:${g.kind}`} value={`${g.division}:${g.kind}`}>
                        {gridLabel(g)}
                        {gt.den !== 1 ? t('（Tick が割り切れません）') : ''}
                      </option>
                    );
                  })}
                </select>
                <span className="segmented zoom-buttons" role="group" aria-label={t('ピアノロールの拡大・縮小')}>
                  <button onClick={() => store.updateSettings(pianoRollZoomPatch(settings, 'out'))} aria-label={t('ピアノロールを縮小')} title={t('横方向に縮小（{mod}+ホイールでも）', { mod: MOD_LABEL })}>
                    −
                  </button>
                  <button onClick={() => store.updateSettings(pianoRollZoomPatch(settings, 'in'))} aria-label={t('ピアノロールを拡大')} title={t('横方向に拡大（{mod}+ホイールでも）', { mod: MOD_LABEL })}>
                    +
                  </button>
                </span>
              </span>
            )}
            <span className="note tab-track">{selectedTrack ? t('編集中: {name}（{port}{channel}）', { name: selectedTrack.name, port: selectedTrack.port, channel: selectedTrack.channel + 1 }) : ''}</span>
            <button
              className="collapse-btn"
              onClick={() => store.updateSettings({ editorCollapsed: !settings.editorCollapsed })}
              aria-label={settings.editorCollapsed ? t('下部エディターを開く') : t('下部エディターを折り畳む')}
              title={settings.editorCollapsed ? t('開く') : t('折り畳む')}
              data-testid="editor-collapse"
            >
              {settings.editorCollapsed ? '▴' : '▾'}
            </button>
          </div>
          {stepMode && !settings.editorCollapsed && <StepPanel drum={inputState.mode === 'step-drums'} />}
          {!settings.editorCollapsed && (
          <div className="editor-body">
            {settings.activePanel === 'piano-roll' && <PianoRoll />}
            {settings.activePanel === 'drum' && <DrumEditor />}
            {settings.activePanel === 'list' && <ListEditor />}
            {settings.activePanel === 'mixer' && <Mixer />}
            {settings.activePanel === 'tempo' && <TempoEditor />}
          </div>
          )}
        </section>

        <footer className="statusbar" aria-live="polite">
          <span data-testid="input-mode" className={inputState.mode !== 'edit-shortcuts' ? 'mode-active' : ''}>
            {t('入力: {mode}', { mode: MODE_LABEL[inputState.mode] })}
            {inputState.mode === 'piano-performance' ? t('（オクターブ {shift}）', { shift: `${project.inputPresets.pianoOctaveShift >= 0 ? '+' : ''}${project.inputPresets.pianoOctaveShift}` }) : ''}
            {inputState.mode === 'piano-performance' || inputState.mode === 'drum-performance' ? t('（Esc で編集へ）') : ''}
          </span>
          <span data-testid="dirty-state">{dirty ? t('● 未保存') : t('保存済み')}</span>
          <span>PPQ {project.ppq}</span>
          <span>{!features.webMidi ? t('Web MIDI: 利用できません — PCキーボード入力は使えます') : midi.state === 'granted' ? t('MIDI 入力: {n} 台', { n: midi.deviceList.filter((d) => d.state === 'connected' && d.enabled).length }) : t('MIDI 入力: 未接続（MIDI → MIDI 入力の設定）')}</span>
          <span className="grow" data-testid="status-info">{info ?? (state.lastAction ? t('最後の操作: {action}', { action: t(state.lastAction) }) : '')}</span>
        </footer>

        {tmOpen && <VisualMonitor onClose={() => setTmOpen(false)} />}

        <input ref={setMidiInput} type="file" hidden accept=".mid,.midi,.rmi,.kar" data-testid="midi-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importMidi(f); e.target.value = ''; }} />
        <input ref={setProjectInput} type="file" hidden accept=".midstudio,.json" data-testid="project-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) void openProject(f); e.target.value = ''; }} />
        <input ref={setSf2Input} type="file" hidden accept=".sf2,.sf3,.dls" onChange={(e) => { const f = e.target.files?.[0]; if (f) { adapter.unlock(); void loadBank(() => f.arrayBuffer(), f.name, f.size); } e.target.value = ''; }} />

        {showStartup && (
          <StartupDialog
            audioPhase={audioPhase}
            progress={progress}
            prefetchState={prefetchState}
            soundBankName={soundBankName}
            midiState={setup.midi}
            midiDevices={midi.deviceList.filter((d) => d.state === 'connected').map((d) => d.name)}
            restore={restore}
            onRetrySoundFont={() => (startPrefetch(), void ensureAudio().catch(() => undefined))}
            onChooseSoundFont={chooseSoundFont}
            onStart={onStartup}
          />
        )}
        <AppDialogs dialog={dialog} setDialog={setDialog} issues={issues} recent={recent} openRecent={(id) => void openRecent(id)} midi={midi} onMidiChange={() => setMidiRev((n) => n + 1)} features={features} soundFont={soundBankBytes} />
      </div>
      </EditActionsContext.Provider>
    </ServicesContext.Provider>
  );
}
