// Visual mode (REQ-PLAY-03/04/05, UI_DESIGN 7). Views: a playback-following
// event list in the style of the
// classic RCM screen (own implementation, no copied artwork: ADR-006). It is a pure view of the
// Transport position: opening / closing it never touches playback.
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import { followState, topRow, type FollowMode } from '../../core/list/follow';
import { formatTicks, listRows, type ListRow } from '../../core/list/listRows';
import { bpmFromUs } from '../../core/timing/tempoMap';
import type { MidiProject, MidiTrack, NoteEvent, TmSettings } from '../../core/model/types';
import { useEditorState, useServices } from '../../app/store/context';
import { useTransportState } from '../../app/hooks/usePlayback';
import { fitCanvas } from '../canvas';
import { AllTracksRoll } from './AllTracksRoll';
import { KeyboardMonitor } from './KeyboardMonitor';
import { useSignatureMap } from '../hooks';
import type { TimeSignatureMap } from '../../core/timing/timeSignatureMap';
import { selectedTrack } from '../../core/model/selectedTrack';

const PANES: Record<TmSettings['layout'], number> = { single: 1, 'columns-2': 2, 'rows-2': 2, quad: 4 };

/** RCM-style note text: "A 4", "F#4", "Bb4", "C-1". */
function rcmNote(r: ListRow): string {
  if (r.event.kind !== 'note') return r.name;
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(r.name);
  return m ? `${m[1]}${m[2] || ' '}${m[3]}` : r.name;
}

type DisplayRow =
  | { kind: 'event'; row: ListRow; showMeas: boolean; step: number | null; eventIndex: number }
  | { kind: 'bar'; key: string; lengthTicks: number };

/** Event rows + measure separators, with MEAS / STEP shown only where they change (RCM layout). */
export function buildDisplayRows(rows: ListRow[], sig: TimeSignatureMap): { display: DisplayRow[]; eventToDisplay: number[] } {
  const display: DisplayRow[] = [];
  const eventToDisplay: number[] = [];
  let meas = -1;
  let step = 0;
  let lastTick = -1;
  rows.forEach((r, i) => {
    const newMeas = r.meas !== meas;
    if (newMeas) {
      if (meas !== -1) display.push({ kind: 'bar', key: `bar-${meas}`, lengthTicks: sig.ticksPerBar(sig.barBeatToTick(meas)) });
      meas = r.meas;
      step = 0;
      lastTick = -1;
    }
    const newGroup = r.tick !== lastTick;
    if (newGroup) step++;
    lastTick = r.tick;
    eventToDisplay.push(display.length);
    display.push({ kind: 'event', row: r, showMeas: newMeas, step: newGroup ? step : null, eventIndex: i });
  });
  return { display, eventToDisplay };
}

export function VisualMonitor({ onClose }: { onClose: () => void }) {
  const { store, transport } = useServices();
  const { project } = useEditorState();
  const tm = project.settings.tm;
  const rootRef = useRef<HTMLDivElement>(null);
  const tstate = useTransportState(transport);
  const sig = useSignatureMap(project);
  const posRef = useRef<HTMLSpanElement>(null);
  const set = (patch: Partial<TmSettings>) => store.updateSettings({ tm: { ...tm, ...patch } });
  const selected = selectedTrack(project);
  const n = PANES[tm.layout];
  const paneTracks: (MidiTrack | undefined)[] = Array.from({ length: n }, (_, i) => {
    const id = tm.paneTracks[i];
    return (id && project.tracks.find((tk) => tk.id === id)) || (i === 0 ? selected : project.tracks[i]) || selected;
  });

  // Position / tempo: written straight to the DOM each frame (no React re-render per frame).
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const pos = transport.getPosition();
      if (posRef.current) {
        const p = sig.tickToBarBeat(Math.max(0, pos.tick));
        const bpm = transport.tempoMap ? bpmFromUs(transport.tempoMap.usPerQuarterAt(pos.tick)) : 120;
        posRef.current.textContent = `:M${String(p.bar).padStart(4, '0')}.${String(p.beat).padStart(2, '0')} ♩${bpm.toFixed(0)}`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [transport, sig]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const status = tstate.status === 'playing' ? 'PLAY' : tstate.status === 'paused' ? 'PAUSE' : 'STOP';
  const view = tm.view ?? 'list';

  return (
    <div className={`tm-root tm-${tm.theme}`} ref={rootRef} style={{ fontSize: tm.fontSize }} role="region" aria-label={t('ビジュアルモード')} data-testid="visual-monitor">
      <div className="tm-titlebar">
        <span className="tm-tag">SONG</span>
        <span className="tm-num">1</span>
        <span className="tm-title">{project.title}</span>
        <span className="tm-pos" ref={posRef} data-testid="tm-clock" />
      </div>
      <div className="tm-statusbar" role="toolbar" aria-label={t('ビジュアルモードの操作')}>
        {/* 1. transport: state box + the three transport buttons */}
        <span className="tm-group tm-transport">
          <span className="tm-mode-box" data-testid="tm-state" data-status={tstate.status}>
            + {status} +
          </span>
          <button onClick={() => transport.seek(0)} aria-label={t('先頭へ')} title={t('先頭へ')}>
            ⏮
          </button>
          <button onClick={() => transport.stop()} aria-label={t('停止')} title={t('停止')}>
            ■
          </button>
          <button className={tstate.status === 'playing' ? 'on' : ''} onClick={() => void transport.togglePlay().catch(() => undefined)} aria-label={tstate.status === 'playing' ? t('一時停止') : t('再生')} title={t('再生 / 一時停止（Space）')}>
            {tstate.status === 'playing' ? '❚❚' : '▶'}
          </button>
        </span>
        <span className="tm-sep" aria-hidden="true" />
        {/* 2. what is shown, followed by the options that belong to that view */}
        <span className="tm-group">
          <span className="tm-views" role="group" aria-label={t('表示')}>
            {(
              [
                ['list', t('数値リスト')],
                ['roll', t('ピアノロール')],
                ['keys', t('鍵盤')],
              ] as const
            ).map(([v, label]) => (
              <button key={v} className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => set({ view: v })} data-testid={`visual-view-${v}`} title={v === 'list' ? t('レコンポーザ風の数値リスト') : undefined}>
                {label}
              </button>
            ))}
          </span>
          {view === 'list' && (
            <>
              <label>
                {t('分割')}
                <select aria-label={t('分割')} value={tm.layout} onChange={(e) => set({ layout: e.target.value as TmSettings['layout'] })}>
                  <option value="single">{t('1 画面')}</option>
                  <option value="columns-2">{t('左右 2 分割')}</option>
                  <option value="rows-2">{t('上下 2 分割')}</option>
                  <option value="quad">{t('4 分割')}</option>
                </select>
              </label>
              <label>
                {t('追従')}
                <select aria-label={t('追従方式')} value={tm.mode} onChange={(e) => set({ mode: e.target.value as FollowMode })} data-testid="tm-mode">
                  <option value="fixed-cursor">Fixed Cursor</option>
                  <option value="page-turn">Page Turn</option>
                  <option value="smooth">Smooth Follow</option>
                </select>
              </label>
              <label>
                {t('単位')}
                <select aria-label={t('単位')} value={tm.unit} onChange={(e) => set({ unit: e.target.value as TmSettings['unit'] })}>
                  <option value="classic48">♩=48</option>
                  <option value="native">Tick</option>
                </select>
              </label>
            </>
          )}
        </span>
        {/* 3. appearance, then the window actions, "back" last and apart */}
        <span className="tm-group tm-right">
          <label>
            {t('配色')}
            <select aria-label={t('配色')} value={tm.theme} onChange={(e) => set({ theme: e.target.value as TmSettings['theme'] })}>
              <option value="rcm">{t('レコンポーザ風')}</option>
              <option value="retro-blue">{t('レトロ（青）')}</option>
              <option value="retro-green">{t('レトロ（緑）')}</option>
              <option value="modern">{t('モダン')}</option>
            </select>
          </label>
          <span className="tm-views" role="group" aria-label={t('文字の大きさ')}>
            <button onClick={() => set({ fontSize: Math.max(10, tm.fontSize - 2) })} aria-label={t('文字を小さく')} title={t('文字を小さく')}>
              A−
            </button>
            <button onClick={() => set({ fontSize: Math.min(48, tm.fontSize + 2) })} aria-label={t('文字を大きく')} title={t('文字を大きく')}>
              A+
            </button>
          </span>
          <span className="tm-sep" aria-hidden="true" />
          <button
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void rootRef.current?.requestFullscreen?.().catch(() => undefined);
            }}
            title={t('全画面（Esc で戻る）')}
          >
            {t('全画面')}
          </button>
          <button className="tm-back" onClick={onClose} data-testid="tm-close" title={t('DAW の画面に戻る（T / Esc）。再生は止まりません')}>
            {t('← DAW に戻る')}
          </button>
        </span>
      </div>
      {view === 'roll' && <AllTracksRoll project={project} />}
      {view === 'keys' && <KeyboardMonitor project={project} />}
      {view === 'list' && (
      <div className={`tm-panes tm-layout-${tm.layout}`}>
        {paneTracks.map((tk, i) =>
          tk ? (
            <TmPane
              key={i}
              index={i}
              track={tk}
              project={project}
              sig={sig}
              mode={tm.mode}
              unit={tm.unit}
              showStaff={tm.layout === 'single' || tm.layout === 'rows-2'}
              onTrackChange={(id) => {
                const next = [...tm.paneTracks];
                next[i] = id;
                set({ paneTracks: next });
              }}
            />
          ) : null,
        )}
      </div>
      )}
    </div>
  );
}

function TmPane({ index, track, project, sig, mode, unit, showStaff, onTrackChange }: { index: number; track: MidiTrack; project: MidiProject; sig: TimeSignatureMap; mode: FollowMode; unit: TmSettings['unit']; showStaff: boolean; onTrackChange: (id: string) => void }) {
  const { transport } = useServices();
  const rows = useMemo(() => listRows(project, track, undefined, sig), [project, track, sig]);
  const { display, eventToDisplay } = useMemo(() => buildDisplayRows(rows, sig), [rows, sig]);
  const ticks = useMemo(() => rows.map((r) => r.tick), [rows]);
  const notes = useMemo(() => track.events.filter((e): e is NoteEvent => e.kind === 'note'), [track.events]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const restRef = useRef<HTMLDivElement>(null);
  const staffRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<{ top: number; current: [number, number] | null }>({ top: 0, current: null });
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const lineH = useRef(24);
  const trackNo = project.tracks.indexOf(track) + 1;

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      const probe = el.querySelector('.tm-row') as HTMLElement | null;
      lineH.current = probe?.offsetHeight || 24;
      setRowsPerPage(Math.max(4, Math.floor(el.clientHeight / lineH.current)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // Follow loop: React state changes only when the current row / page changes; smooth scrolling
  // and the staff are drawn directly.
  useEffect(() => {
    let raf = 0;
    let smoothTop = 0;
    let lastKey = '';
    const loop = () => {
      const pos = transport.getPosition();
      const f = followState(ticks, pos.tick);
      const curDisplay = f.current ? eventToDisplay[f.current[0]] : 0;
      const target = topRow(mode, curDisplay, rowsPerPage, display.length);
      const key = `${target}:${f.current?.[0]}:${f.current?.[1]}`;
      if (key !== lastKey) {
        lastKey = key;
        setView({ top: mode === 'smooth' ? 0 : target, current: f.current });
      }
      if (mode === 'smooth' && innerRef.current) {
        // display easing only; the musical position always comes from the Transport
        const jump = Math.abs(target - smoothTop) > rowsPerPage;
        smoothTop = jump ? target : smoothTop + (target - smoothTop) * 0.2;
        innerRef.current.style.transform = `translateY(${-smoothTop * lineH.current}px)`;
      } else if (innerRef.current) innerRef.current.style.transform = '';
      if (restRef.current) {
        const long = f.ticksToNext !== null && f.ticksToNext > project.ppq * 2;
        restRef.current.textContent = long ? `NEXT ${formatTicks(Math.round(f.ticksToNext!), unit, project.ppq)}` : '';
      }
      if (staffRef.current) drawStaff(staffRef.current, notes, pos.tick, f.current ? rows.slice(f.current[0], f.current[1] + 1) : [], project);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [transport, ticks, rows, display.length, eventToDisplay, mode, rowsPerPage, unit, project, notes]);

  const start = mode === 'smooth' ? 0 : view.top;
  const end = mode === 'smooth' ? display.length : Math.min(display.length, view.top + rowsPerPage + 1);
  const silenced = (project.tracks.some((tk) => tk.solo) && !track.solo) || track.mute;
  const cur = view.current;

  return (
    <div className="tm-pane" data-testid={`tm-pane-${index}`}>
      <div className="tm-trackbar">
        <span className="tm-tag">TR.</span>
        <span className="tm-num">{trackNo}</span>
        <select className="tm-track-select" aria-label={t('ペイン {n} のトラック', { n: index + 1 })} value={track.id} onChange={(e) => onTrackChange(e.target.value)}>
          {project.tracks.map((tk, i) => (
            <option key={tk.id} value={tk.id}>
              {i + 1}: {tk.name}（{tk.port}
              {tk.channel + 1}）
            </option>
          ))}
        </select>
        {silenced && <span className="tm-muted">{track.mute ? 'MUTE' : t('SOLO外')}</span>}
      </div>
      <div className="tm-pane-body">
        <div className="tm-list">
          <div className="tm-row tm-colhead">
            <span className="c-meas">MEAS</span>
            <span className="c-step">STEP:</span>
            <span className="c-note">NOTE</span>
            <span className="c-key">K#</span>
            <span className="c-st">ST</span>
            <span className="c-gt">GT</span>
            <span className="c-vel">VEL</span>
          </div>
          <div className="tm-body" ref={bodyRef}>
            <div ref={innerRef}>
              {display.slice(start, end).map((d) => {
                if (d.kind === 'bar')
                  return (
                    <div key={d.key} className="tm-row tm-bar">
                      <span className="c-meas" />
                      <span className="c-step">:</span>
                      <span className="c-note">-------</span>
                      <span className="c-key" />
                      <span className="c-st">{formatTicks(d.lengthTicks, unit, project.ppq)}</span>
                      <span className="c-gt">------</span>
                      <span className="c-vel">---</span>
                    </div>
                  );
                const r = d.row;
                const inGroup = cur && d.eventIndex >= cur[0] && d.eventIndex <= cur[1];
                const cls = inGroup ? (d.eventIndex === cur![0] ? ' now-first' : ' now') : '';
                return (
                  <div key={r.id} className={`tm-row${cls}`} data-testid={inGroup ? 'tm-now' : undefined}>
                    <span className="c-meas">{d.showMeas ? r.meas : ''}</span>
                    <span className="c-step">{d.step !== null ? `${d.step}:` : ':'}</span>
                    <span className="c-note">{rcmNote(r)}</span>
                    <span className="c-key">{r.key ?? ''}</span>
                    <span className="c-st">{r.stTicks ? formatTicks(r.stTicks, unit, project.ppq) : ''}</span>
                    <span className="c-gt">{r.gtTicks === null ? '' : formatTicks(r.gtTicks, unit, project.ppq)}</span>
                    <span className="c-vel">{r.value ?? ''}</span>
                  </div>
                );
              })}
              {rows.length === 0 && <div className="tm-row">{t('（イベントなし）')}</div>}
            </div>
          </div>
          <div className="tm-rest" ref={restRef} aria-live="off" />
        </div>
        {showStaff && <canvas ref={staffRef} className="tm-staff" aria-label={t('鳴っている音の譜表表示')} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- staff

const LETTER_STEP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; // C C# D D# E F F# G G# A A# B
const diatonic = (pitch: number) => (Math.floor(pitch / 12) - 1) * 7 + LETTER_STEP[pitch % 12];

const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B (letter index C=0..B=6)
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];

/**
 * Staff spelling of a pitch under a key signature (sharpsFlats -7..7): the staff step and the
 * accidental to print. Black keys are spelled with sharps (no key / sharp keys) or flats (flat
 * keys); accidentals already in the key signature are omitted, cancelled ones get a natural.
 */
export function spellPitch(pitch: number, sharpsFlats: number): { step: number; accidental: '♯' | '♭' | '♮' | '' } {
  const pc = ((pitch % 12) + 12) % 12;
  const octave = Math.floor(pitch / 12) - 1;
  let letter = NATURAL_PC.indexOf(pc);
  let acc: '♯' | '♭' | '' = '';
  if (letter < 0) {
    if (sharpsFlats < 0) {
      letter = NATURAL_PC.indexOf(pc + 1);
      acc = '♭';
    } else {
      letter = NATURAL_PC.indexOf(pc - 1);
      acc = '♯';
    }
  }
  const keyAcc = sharpsFlats > 0 && SHARP_ORDER.slice(0, sharpsFlats).includes(letter) ? '♯' : sharpsFlats < 0 && FLAT_ORDER.slice(0, -sharpsFlats).includes(letter) ? '♭' : '';
  const accidental = acc === keyAcc ? '' : acc === '' ? '♮' : acc;
  return { step: octave * 7 + letter, accidental };
}
const D_E4 = diatonic(64);
/** standard key-signature positions on the treble staff (natural pitches): F5 C5 G5 D5 A4 E5 B4 / B4 E5 A4 D5 G4 C5 F4 */
const KEY_SHARP_TREBLE = [77, 72, 79, 74, 69, 76, 71];
const KEY_FLAT_TREBLE = [71, 76, 69, 74, 67, 72, 65];
const D_G2 = diatonic(43);

/** Grand staff with the notes sounding at `tick`: current-group notes white / yellow, held notes cyan. */
function drawStaff(canvas: HTMLCanvasElement, notes: readonly NoteEvent[], tick: number, currentRows: ListRow[], project: MidiProject) {
  const w = canvas.clientWidth || 200;
  const h = canvas.clientHeight || 300;
  const ctx = fitCanvas(canvas, w, h, { cssSized: true });
  if (!ctx) return;
  const cs = getComputedStyle(canvas);
  const lineColor = cs.getPropertyValue('--tm-staff').trim() || '#3ad14a';
  const nowColor = cs.getPropertyValue('--tm-now-first-dot').trim() || '#ffffff';
  const groupColor = cs.getPropertyValue('--tm-now').trim() || '#f0e050';
  const heldColor = cs.getPropertyValue('--tm-text').trim() || '#5ec8f0';
  ctx.clearRect(0, 0, w, h);
  // vertical scale: C1 (bottom) .. C8 (top)
  const lo = diatonic(24);
  const hi = diatonic(108);
  // fill the whole pane height: C1 at the bottom edge, C8 at the top edge
  const gap = Math.max(2, (h - 8) / (hi - lo));
  const yOf = (d: number) => h - 4 - (d - lo) * gap;
  const staffX0 = w * 0.18;
  const staffX1 = w * 0.92;
  const ledgerX0 = w * 0.42;
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  // ledger zone (above treble / below bass, narrower) and the two staves
  for (let d = lo; d <= hi; d++) {
    if ((((d - D_E4) % 2) + 2) % 2 !== 0) continue; // lines sit on E4, G4, B4 ... (every other step)
    const inTreble = d >= D_E4 && d <= D_E4 + 8;
    const inBass = d >= D_G2 && d <= D_G2 + 8;
    const between = d > D_G2 + 8 && d < D_E4;
    if (between) continue;
    const y = Math.round(yOf(d));
    ctx.beginPath();
    ctx.moveTo(inTreble || inBass ? staffX0 : ledgerX0, y);
    ctx.lineTo(staffX1, y);
    ctx.stroke();
  }
  ctx.fillStyle = lineColor;
  const space = gap * 2; // distance between two staff lines
  // G clef curls around the G4 line; F clef's dots straddle the F3 line (SMuFL proportions)
  drawClef(ctx, '𝄞', yOf(D_E4 + 2), 4.39, 2.63, staffX0, space);
  drawClef(ctx, '𝄢', yOf(D_G2 + 6), 1.02, 2.54, staffX0, space);
  // key signature from the conductor (sharps / flats count only)
  const key = [...project.conductor].reverse().find((c) => c.kind === 'key-signature' && c.tick <= tick);
  if (key && key.kind === 'key-signature' && key.sharpsFlats !== 0) {
    ctx.font = `${Math.round(gap * 2.6)}px "Apple Symbols", "Segoe UI Symbol", serif`;
    const sym = key.sharpsFlats > 0 ? '♯' : '♭';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const places = key.sharpsFlats > 0 ? KEY_SHARP_TREBLE : KEY_FLAT_TREBLE;
    for (let i = 0; i < Math.min(7, Math.abs(key.sharpsFlats)); i++) {
      const kx = staffX0 + gap * (6 + i * 1.8);
      ctx.fillText(sym, kx, yOf(diatonic(places[i])));
      ctx.fillText(sym, kx, yOf(diatonic(places[i] - 24))); // bass staff: two octaves lower
    }
    ctx.textAlign = 'start';
  }
  // notes: same column; accidentals (♯ ♭ ♮) to the left; a note a second away from the previous
  // one is placed on the other side of the stem line, as in printed music
  const x = (staffX0 + staffX1) / 2 + gap * 3;
  const r = Math.max(2.5, gap * 0.9);
  const curIds = new Set(currentRows.map((row) => row.id));
  const firstId = currentRows.find((row) => row.event.kind === 'note')?.id;
  const sf = key && key.kind === 'key-signature' ? key.sharpsFlats : 0;
  const sounding = notes
    .filter((n) => n.tick <= tick && tick < n.tick + n.durationTicks)
    .map((n) => ({ n, sp: spellPitch(n.pitch, sf) }))
    .sort((a, b) => a.sp.step - b.sp.step);
  let prevStep = -999;
  let prevShifted = false;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.font = `${Math.round(gap * 2.6)}px "Apple Symbols", "Segoe UI Symbol", serif`;
  for (const { n, sp } of sounding) {
    const shifted: boolean = sp.step - prevStep === 1 && !prevShifted;
    prevStep = sp.step;
    prevShifted = shifted;
    const nx = x + (shifted ? r * 2.1 : 0);
    const y = yOf(sp.step);
    const color = n.id === firstId ? nowColor : curIds.has(n.id) ? groupColor : heldColor;
    if (sp.step === diatonic(60)) {
      // middle C sits on its own ledger line between the staves
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(nx - r * 1.8, Math.round(y));
      ctx.lineTo(nx + r * 1.8, Math.round(y));
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(nx, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (sp.accidental) ctx.fillText(sp.accidental, x - r * 1.6, y);
  }
  ctx.textAlign = 'left';
}

const CLEF_FONT = '"Bravura", "Apple Symbols", "Segoe UI Symbol", "Noto Music", serif';

/**
 * Draws a clef glyph scaled and placed by its measured ink box, so that it extends `above` staff
 * spaces above and `below` spaces below `lineY` (the G or F line), whatever font provides it.
 */
function drawClef(ctx: CanvasRenderingContext2D, glyph: string, lineY: number, above: number, below: number, x: number, space: number) {
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `100px ${CLEF_FONT}`;
  const m = ctx.measureText(glyph);
  const ink = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  if (!(ink > 0)) return;
  const size = (100 * (above + below) * space) / ink;
  ctx.font = `${size}px ${CLEF_FONT}`;
  const m2 = ctx.measureText(glyph);
  const top = lineY - above * space;
  ctx.fillText(glyph, x, top + m2.actualBoundingBoxAscent);
}
