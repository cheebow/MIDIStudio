// Guitar voicing for a chord progression (ADR-091 追記): the chords of the chord-name strip (ADR-090)
// over a range — the loop range by default, else four bars from the right-click — laid out with the
// first (most usual, open first) form of each, which can be changed; all go in as one undo step. A
// progression can also be typed in bar notation ("Am7 | F | C G"). A chord without a form is shown with
// its reason and left out (never replaced by another chord); the insert button says how many go in.
import { useEffect, useRef, useState } from 'react';
import { useEditorState, useServices } from '../../app/store/context';
import { t } from '../../i18n';
import { Dialog } from '../Dialog';
import { useSignatureMap } from '../hooks';
import { parseChordSymbol } from '../../core/guitar/chordSymbol';
import { formLabel, formsFor, fretsToPitches, pitchNames } from '../../core/guitar/voicing';
import { buildVoicingCommand } from '../../core/guitar/insertVoicing';
import { barsEnd, defaultProgressionRange, parseProgression, rowsFromChords, type ProgressionRow } from '../../core/guitar/progression';
import type { ChordSegment } from '../../core/theory/chords';
import { GuitarDiagram } from './GuitarDiagram';
import { NEW_TRACK, TargetSelect, useMelodicTracks, useVoicingPreview } from './guitarShared';

export interface GuitarProgressionRequest {
  trackId: string;
  /** the right-clicked tick */
  tick: number;
  /** the loop range at the right-click */
  loop: { startTick: number; endTick: number };
  /** the chord analysis read at the right-click (empty: none / chord names off) */
  chords: ChordSegment[];
  returnFocus?: HTMLElement | null;
}

interface Row extends ProgressionRow {
  key: number;
  /** index into the chord's forms (0: the first, open first) */
  formIndex: number;
}

let rowKey = 0;
const toRows = (rows: ProgressionRow[]): Row[] => rows.map((r) => ({ ...r, key: ++rowKey, formIndex: 0 }));
const CLICK_BARS = 4;

export function GuitarProgressionDialog({ request, onClose }: { request: GuitarProgressionRequest; onClose: () => void }) {
  const { store, reportError } = useServices();
  const { project } = useEditorState();
  const sig = useSignatureMap(project);
  const melodic = useMelodicTracks();
  const clickRange = { start: request.tick, end: barsEnd(sig, request.tick, CLICK_BARS) };
  const loopRange = request.loop.endTick > request.loop.startTick ? { start: request.loop.startTick, end: request.loop.endTick } : null;
  const initial = defaultProgressionRange(request.tick, request.loop, clickRange.end);
  const [startText, setStartText] = useState(() => sig.format(initial.start));
  const [endText, setEndText] = useState(() => sig.format(initial.end));
  const parsedStart = sig.parse(startText);
  const parsedEnd = sig.parse(endText);
  const start = parsedStart === null ? null : Math.round(parsedStart);
  const end = parsedEnd === null ? null : Math.round(parsedEnd);
  const rangeError = start === null || end === null ? t('位置は 小節.拍.Tick（例 5.1.0、または小節番号だけ）で入力してください。') : end <= start ? t('範囲の終わりは始まりより後にしてください') : null;
  const analysed = request.chords.length > 0;
  /** 'analysis': the rows follow the range; 'text': typed by hand */
  const [source, setSource] = useState<'analysis' | 'text'>(analysed ? 'analysis' : 'text');
  const [rows, setRows] = useState<Row[]>(() => (analysed ? toRows(rowsFromChords(request.chords, initial.start, initial.end)) : []));
  const [text, setText] = useState('');
  const [textError, setTextError] = useState<string | null>(null);
  // slash chords from the detection are common (Am7/E): their bass is ignored unless unticked (shown)
  const [ignoreBass, setIgnoreBass] = useState(true);
  const [target, setTarget] = useState(() => (melodic.some((tr) => tr.id === request.trackId) ? request.trackId : NEW_TRACK));
  const targetTrackId = target === NEW_TRACK ? null : melodic.some((tr) => tr.id === target) ? target : null;
  const preview = useVoicingPreview(targetTrackId, request.returnFocus);
  const textInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!analysed) textInput.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the dialog opens
  }, []);
  /** New range text: the detected chords follow it (the analysis itself was read once, at the right-click). */
  const changeRange = (nextStart: string, nextEnd: string) => {
    setStartText(nextStart);
    setEndText(nextEnd);
    const a = sig.parse(nextStart);
    const b = sig.parse(nextEnd);
    if (source === 'analysis' && a !== null && b !== null && b > a) setRows(toRows(rowsFromChords(request.chords, Math.round(a), Math.round(b))));
  };
  const setRange = (r: { start: number; end: number }) => changeRange(sig.format(r.start), sig.format(r.end));

  const resolve = (r: Row) => {
    const parsed = parseChordSymbol(r.text);
    if (!parsed.ok) return { problem: parsed.reason === 'empty' ? t('コードがありません') : t('コード名を読み取れません'), forms: [] };
    const search = formsFor(parsed.chord, { ignoreBass });
    if (search.kind === 'no-forms') return { problem: t('登録フォームなし'), forms: [] };
    if (search.kind === 'no-bass-forms') return { problem: t('ベース音で始まるフォームなし'), forms: [] };
    return { problem: null, forms: search.forms };
  };
  const resolved = rows.map((r) => ({ row: r, ...resolve(r) }));
  const ok = resolved.filter((x) => x.forms.length > 0);
  const skipped = resolved.length - ok.length;
  const hasSlash = resolved.some((x) => {
    const p = parseChordSymbol(x.row.text);
    return p.ok && p.chord.bass !== null;
  });

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const loadAnalysis = () => {
    setSource('analysis');
    if (start !== null && end !== null && end > start) setRows(toRows(rowsFromChords(request.chords, start, end)));
    setTextError(null);
  };
  const loadText = () => {
    if (start === null) return;
    const parsed = parseProgression(text, start, sig);
    if (parsed.length === 0) {
      setTextError(t('コード進行を入力してください（例: Am7 | Dm7 G7 | Cmaj7）'));
      return;
    }
    setSource('text');
    setRows(toRows(parsed));
    setTextError(null);
  };

  const reason = rangeError ?? (rows.length === 0 ? t('コード進行がありません') : ok.length === 0 ? t('入れられるコードがありません') : null);

  const insert = () => {
    if (reason) return;
    try {
      const r = buildVoicingCommand(store.project, {
        target: targetTrackId ? { trackId: targetTrackId } : { newTrack: { name: t('ギター') } },
        chords: ok.map((x) => ({ tick: x.row.tick, length: x.row.length, pitches: fretsToPitches(x.forms[Math.min(x.row.formIndex, x.forms.length - 1)].frets) })),
        velocity: store.project.inputPresets.defaultVelocity,
      });
      store.run(r.command, r.trackId === request.trackId ? { select: r.ids } : {});
      onClose();
    } catch (e) {
      reportError(t((e as Error).message));
    }
  };

  const lengthText = (r: Row) => {
    const bar = sig.ticksPerBar(r.tick);
    const beat = sig.ticksPerBeat(r.tick);
    return r.length % bar === 0 ? t('{n} 小節', { n: r.length / bar }) : r.length % beat === 0 ? t('{n} 拍', { n: r.length / beat }) : t('{n} Tick', { n: r.length });
  };

  return (
    <Dialog title={t('コード進行をギターで入力')} onClose={onClose} wide>
      <form
        className="form-grid guitar-voicing"
        data-testid="guitar-progression-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          insert();
        }}
      >
        <div className="gv-chord-row">
          <label>
            {t('範囲')}
            <input type="text" value={startText} onChange={(e) => changeRange(e.target.value, endText)} className="gv-pos-input" spellCheck={false} data-testid="gp-start" />
          </label>
          <span className="gp-tilde">〜</span>
          <label>
            {t('終わり（含まない）')}
            <input type="text" value={endText} onChange={(e) => changeRange(startText, e.target.value)} className="gv-pos-input" spellCheck={false} data-testid="gp-end" />
          </label>
          {loopRange && (
            <button type="button" onClick={() => setRange(loopRange)} data-testid="gp-range-loop">
              {t('ループ範囲')}
            </button>
          )}
          <button type="button" onClick={() => setRange(clickRange)} data-testid="gp-range-click">
            {t('右クリック位置から {n} 小節', { n: CLICK_BARS })}
          </button>
          {source === 'text' && analysed && (
            <button type="button" onClick={loadAnalysis} data-testid="gp-from-analysis">
              {t('コード判定から読み込む')}
            </button>
          )}
        </div>
        {rangeError && <p className="note gv-warn">{rangeError}</p>}
        {!analysed && <p className="note">{t('コード名の推定がありません（表示 › コード名（推定）が OFF か、和音がありません）。コード進行を手で入力してください。')}</p>}
        <details className="gp-manual" open={!analysed}>
          <summary>{t('手で入力')}</summary>
          <div className="gv-chord-row">
            <label className="gv-progression-text">
              {t('コード進行（| で小節を区切る。1 小節に 2 つ書くと半分ずつ）')}
              <input
                ref={textInput}
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    loadText();
                  }
                }}
                placeholder="Am7 | Dm7 G7 | Cmaj7"
                spellCheck={false}
                autoComplete="off"
                data-testid="gp-text"
              />
            </label>
            <button type="button" onClick={loadText} disabled={start === null} data-testid="gp-from-text">
              {t('この進行で並べる')}
            </button>
          </div>
        </details>
        {textError && <p className="note gv-warn">{textError}</p>}

        {rows.length > 0 ? (
          <div className="gp-rows" data-testid="gp-rows">
            {resolved.map(({ row, forms, problem }) => {
              const i = Math.min(row.formIndex, Math.max(0, forms.length - 1));
              const f = forms[i];
              const pitches = f ? fretsToPitches(f.frets) : [];
              return (
                <div key={row.key} className={`gp-row${problem ? ' skipped' : ''}`} data-testid="gp-row">
                  <div className="gp-head">
                    <span className="gp-pos">{sig.format(row.tick)}</span>
                    <span className="note">{lengthText(row)}</span>
                    <button type="button" className="gp-remove" aria-label={t('この行を外す')} title={t('この行を外す')} onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}>
                      ×
                    </button>
                  </div>
                  <input type="text" className="gp-chord" value={row.text} aria-label={t('コード')} onChange={(e) => update(row.key, { text: e.target.value, formIndex: 0 })} spellCheck={false} data-testid="gp-chord" />
                  {f ? (
                    <>
                      <span className="gp-form" data-testid="gp-form" data-frets={formLabel(f.frets)} title={pitchNames(pitches)}>
                        <GuitarDiagram frets={f.frets} label={formLabel(f.frets)} />
                        <span className="gv-label">{formLabel(f.frets)}</span>
                      </span>
                      <div className="gp-controls">
                        <button type="button" className="gp-step" aria-label={t('前のフォーム')} disabled={i === 0} onClick={() => update(row.key, { formIndex: i - 1 })}>
                          ‹
                        </button>
                        <span className="note">
                          {i + 1}/{forms.length}
                        </span>
                        <button type="button" className="gp-step" aria-label={t('次のフォーム')} disabled={i >= forms.length - 1} onClick={() => update(row.key, { formIndex: i + 1 })}>
                          ›
                        </button>
                        <button type="button" onClick={() => preview.play(pitches)} disabled={!preview.ready} title={!preview.ready ? t('音源が読み込まれていないため試聴できません') : t('試聴')} aria-label={t('試聴')}>
                          ♪
                        </button>
                      </div>
                    </>
                  ) : (
                    <span className="note gv-warn gp-problem" data-testid="gp-problem">
                      {problem}
                      {t('（入りません）')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="note">{source === 'analysis' ? t('この範囲にはコード名の推定がありません。') : t('コード進行を入力して「この進行で並べる」を押してください。')}</p>
        )}
        {hasSlash && (
          <label className="gp-ignore-bass">
            <input type="checkbox" checked={ignoreBass} onChange={(e) => setIgnoreBass(e.target.checked)} data-testid="gp-ignore-bass" /> {t('分数コードのベース音を無視してフォームを探す（ベース音は最低音になりません。外すとベース音で始まるフォームだけ）')}
          </label>
        )}
        <div className="gv-place-row">
          <TargetSelect value={target} onChange={setTarget} />
        </div>
        {skipped > 0 && ok.length > 0 && <p className="note gv-warn" data-testid="gp-skipped">{t('{n} 個のコードはフォームが無いため入りません。', { n: skipped })}</p>}
        <div className="row">
          <button type="submit" className="primary" disabled={!!reason} data-testid="gp-insert">
            {t('挿入（{n} コード）', { n: ok.length })}
          </button>
          <button type="button" onClick={onClose}>
            {t('キャンセル')}
          </button>
          {reason && <span className="note">{reason}</span>}
        </div>
      </form>
    </Dialog>
  );
}

