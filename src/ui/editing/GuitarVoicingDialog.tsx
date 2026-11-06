// Guitar-voicing input assistant (ADR-091): pick a chord (typed, or root + type), choose one of the
// curated forms, listen to it and insert its notes at the tick fixed by the right-click. Opened from the
// piano roll and the list editor (右クリック › 入力支援 › ギターボイシング › コードを 1 つ入力…). The chord detected there,
// if any, is only a starting value: it was read once, when the menu was used, and is never re-read.
// Nothing is written to the song until 挿入; previews go to the preview synth and are released on close.
import { useEffect, useMemo, useRef, useState } from 'react';
import { NEW_TRACK, TargetSelect, useMelodicTracks, useVoicingPreview } from './guitarShared';
import { useEditorState, useServices } from '../../app/store/context';
import { t } from '../../i18n';
import { Dialog } from '../Dialog';
import { NumberInput } from '../NumberInput';
import { useSignatureMap } from '../hooks';
import { CHORD_QUALITIES, chordSuffix, pcName, type ChordQuality } from '../../core/theory/chords';
import { formatChordSymbol, parseChordSymbol, type ChordSymbol } from '../../core/guitar/chordSymbol';
import { formLabel, formsFor, fretsToPitches, pitchNames } from '../../core/guitar/voicing';
import { GUITAR_QUALITIES, type PositionLabel } from '../../core/guitar/voicingCatalog';
import { buildVoicingCommand, NO_FREE_CHANNEL, overlappingNotes, validateInsert } from '../../core/guitar/insertVoicing';
import { freeChannel } from '../../core/editing/operations';
import type { ChordCandidate } from '../../core/guitar/chordContext';
import { GuitarDiagram } from './GuitarDiagram';

export interface GuitarVoicingRequest {
  /** the track that was right-clicked */
  trackId: string;
  /** absolute tick fixed at the right-click */
  tick: number;
  /** chord analysis at that tick, read at the right-click (empty: none / analysis off) */
  candidates: ChordCandidate[];
  /** focus goes back here when the dialog closes */
  returnFocus?: HTMLElement | null;
}

const ROOT_LABELS = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];
const POSITION_LABEL: Record<PositionLabel, string> = { open: 'オープン', low: 'ロー', mid: 'ミドル', high: 'ハイ' };

type LengthMode = 'chord' | 'bar1' | 'bar2' | 'beat2' | 'beat1' | 'custom';

const qualityLabel = (q: ChordQuality) => (q === 'maj' ? 'maj' : chordSuffix(q));

export function GuitarVoicingDialog({ request, onClose }: { request: GuitarVoicingRequest; onClose: () => void }) {
  const { store, reportError } = useServices();
  const { project } = useEditorState();
  const sig = useSignatureMap(project);
  const single = request.candidates.length === 1 ? request.candidates[0] : null;
  const [candidate, setCandidate] = useState<ChordCandidate | null>(single);
  const [text, setText] = useState(single?.chordSymbol ?? '');
  /** null: the first (most usual, open first) form of the chord */
  const [formId, setFormId] = useState<string | null>(null);
  /** the user chose to look up a slash chord without its bass ("no-bass-forms" → button) */
  const [ignoreBass, setIgnoreBass] = useState(false);
  const [tickText, setTickText] = useState(() => sig.format(request.tick));
  const [lengthMode, setLengthMode] = useState<LengthMode>(single ? 'chord' : 'bar1');
  const [customLength, setCustomLength] = useState(() => sig.ticksPerBar(request.tick));
  const melodic = useMelodicTracks();
  const [target, setTarget] = useState(() => (melodic.some((tr) => tr.id === request.trackId) ? request.trackId : NEW_TRACK));
  const chordInput = useRef<HTMLInputElement>(null);

  const parsed = parseChordSymbol(text);
  const chord = parsed.ok ? parsed.chord : null;
  const search = chord ? formsFor(chord, { ignoreBass }) : null;
  const forms = search?.kind === 'forms' ? search.forms : [];
  const form = forms.find((f) => f.id === formId) ?? forms[0] ?? null;
  const pitches = form ? fretsToPitches(form.frets) : [];

  const parsedTick = sig.parse(tickText);
  const tick = parsedTick === null ? null : Math.round(parsedTick);
  const lengthFor = (mode: LengthMode, at: number): number => {
    switch (mode) {
      case 'chord':
        return candidate ? candidate.endTick - at : 0;
      case 'bar1':
        return sig.ticksPerBar(at);
      case 'bar2':
        return sig.ticksPerBar(at) + sig.ticksPerBar(at + sig.ticksPerBar(at));
      case 'beat2':
        return Math.round(sig.ticksPerBeat(at) * 2);
      case 'beat1':
        return Math.round(sig.ticksPerBeat(at));
      case 'custom':
        return customLength;
    }
  };
  const length = tick === null ? 0 : Math.round(lengthFor(lengthMode, tick));
  const targetTrackId = target === NEW_TRACK ? null : melodic.some((tr) => tr.id === target) ? target : null;
  const overlaps = tick === null ? 0 : overlappingNotes(project, targetTrackId, tick, Math.max(0, length));

  const preview = useVoicingPreview(targetTrackId, request.returnFocus);
  useEffect(() => {
    if (!single) chordInput.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the dialog opens
  }, []);

  /** A new chord (typed or picked) drops the form chosen for the previous one. */
  const changeText = (next: string) => {
    const a = parseChordSymbol(text);
    const b = parseChordSymbol(next);
    if (!(a.ok && b.ok && a.chord.root === b.chord.root && a.chord.quality === b.chord.quality && a.chord.bass === b.chord.bass)) {
      setFormId(null);
      setIgnoreBass(false);
    }
    setText(next);
  };
  const pick = (patch: Partial<ChordSymbol>) => {
    const base: ChordSymbol = chord ?? { root: 0, rootName: 'C', quality: 'maj', bass: null, bassName: null };
    const next = { ...base, ...patch };
    if (patch.root !== undefined && patch.root !== base.root) next.rootName = pcName(patch.root, 0);
    changeText(formatChordSymbol(next));
  };
  const pickCandidate = (c: ChordCandidate) => {
    setCandidate(c);
    changeText(c.chordSymbol);
    setLengthMode('chord');
  };

  const chordProblem =
    request.candidates.length > 1 && !candidate && text.trim() === ''
      ? t('この位置には複数のコード判定があります。どれかを選ぶか、コード名を入力してください')
      : !parsed.ok
        ? parsed.reason === 'empty'
          ? t('コードを入力するか、ルートと種類を選んでください')
          : t('コード名を読み取れません（例: Cmaj7, Am7, F#m7b5）')
        : search?.kind === 'no-forms'
          ? t('{chord} の登録フォームはありません（登録済み: maj, m, 7, maj7, m7）', { chord: text.trim() })
          : search?.kind === 'no-bass-forms'
            ? t('{chord} のベース音で始まるフォームは登録されていません（分数コードはベース音まで一致するフォームだけを出します）', { chord: text.trim() })
            : null;
  const lengthProblem = tick === null ? null : validateInsert(tick, length);
  const reason =
    chordProblem ??
    (!form
      ? t('フォームを選んでください')
      : tick === null
        ? t('位置は 小節.拍.Tick（例 5.1.0、または小節番号だけ）で入力してください。')
        : lengthProblem
          ? t(lengthProblem)
          : target !== NEW_TRACK && !targetTrackId
            ? t('挿入先のトラックを選んでください')
            : target === NEW_TRACK && freeChannel(project) === null
              ? t(NO_FREE_CHANNEL)
              : null);

  const insert = () => {
    if (reason || !form || tick === null) return;
    try {
      const r = buildVoicingCommand(store.project, {
        target: targetTrackId ? { trackId: targetTrackId } : { newTrack: { name: t('ギター') } },
        chords: [{ tick, length, pitches }],
        velocity: store.project.inputPresets.defaultVelocity,
      });
      // the inserted notes are selected only where the editor shows them (the right-clicked track)
      store.run(r.command, r.trackId === request.trackId ? { select: r.ids } : {});
      onClose();
    } catch (e) {
      reportError(t((e as Error).message));
    }
  };

  const lengthOptions = useMemo(
    () =>
      [
        ...(candidate ? [['chord', t('コード判定の区間の終わりまで')] as const] : []),
        ['bar1', t('1 小節')],
        ['bar2', t('2 小節')],
        ['beat2', t('2 拍')],
        ['beat1', t('1 拍')],
        ['custom', t('Tick で指定')],
      ] as const,
    [candidate],
  );

  return (
    <Dialog title={t('ギターボイシング')} onClose={onClose} wide>
      <form
        className="form-grid guitar-voicing"
        data-testid="guitar-voicing-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          insert();
        }}
      >
        <div className="gv-chord-row">
          <label className="gv-chord-text">
            {t('コード')}
            <input ref={chordInput} type="text" value={text} onChange={(e) => changeText(e.target.value)} placeholder="Cmaj7" spellCheck={false} autoComplete="off" data-testid="gv-chord" aria-invalid={!!text.trim() && !parsed.ok} />
          </label>
          <label>
            {t('ルート')}
            <select value={chord ? String(chord.root) : ''} onChange={(e) => pick({ root: Number(e.target.value) })} data-testid="gv-root">
              {!chord && <option value="">—</option>}
              {ROOT_LABELS.map((l, pc) => (
                <option key={pc} value={pc}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('種類')}
            <select value={chord ? chord.quality : ''} onChange={(e) => pick({ quality: e.target.value as ChordQuality })} data-testid="gv-quality">
              {!chord && <option value="">—</option>}
              {GUITAR_QUALITIES.map((q) => (
                <option key={q} value={q}>
                  {qualityLabel(q)}
                </option>
              ))}
              <optgroup label={t('登録フォームなし')}>
                {CHORD_QUALITIES.filter((q) => !GUITAR_QUALITIES.includes(q)).map((q) => (
                  <option key={q} value={q}>
                    {qualityLabel(q)}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        </div>
        {request.candidates.length > 1 && (
          <div className="gv-candidates" role="group" aria-label={t('この位置のコード判定')}>
            <span className="note">{t('この位置のコード判定:')}</span>
            {request.candidates.map((c, i) => (
              <button key={i} type="button" aria-pressed={candidate === c} onClick={() => pickCandidate(c)} data-testid="gv-candidate">
                {c.chordSymbol}
              </button>
            ))}
          </div>
        )}
        {candidate && text === candidate.chordSymbol && <p className="note" data-testid="gv-from-analysis">{t('既存のコード判定から入力（変更できます）')}</p>}

        <fieldset className="gv-forms-box">
          <legend>{t('フォーム候補')}</legend>
          {forms.length > 0 ? (
            <div className="gv-forms" role="radiogroup" aria-label={t('フォーム候補')}>
              {forms.map((f) => {
                const label = formLabel(f.frets);
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={f.id === form?.id}
                    className={`gv-form${f.id === form?.id ? ' selected' : ''}`}
                    onClick={() => setFormId(f.id)}
                    data-testid="gv-form"
                    data-frets={label}
                  >
                    <GuitarDiagram frets={f.frets} label={label} />
                    <span className="gv-pos">{t(POSITION_LABEL[f.positionLabel])}</span>
                    <span className="gv-label">{label}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="gv-problem">
              <p className="note" data-testid="gv-chord-problem">
                {chordProblem ?? ''}
              </p>
              {search?.kind === 'no-bass-forms' && chord && (
                <button type="button" onClick={() => setIgnoreBass(true)} data-testid="gv-ignore-bass">
                  {t('ベース音（{bass}）を無視して {chord} のフォームから選ぶ', { bass: chord.bassName ?? '', chord: formatChordSymbol({ ...chord, bass: null, bassName: null }) })}
                </button>
              )}
            </div>
          )}
          {ignoreBass && chord?.bass !== null && forms.length > 0 && (
            <p className="note" data-testid="gv-bass-ignored">
              {t('ベース音 {bass} を無視しています（{bass} を含むフォームを先に並べます。最低音にはなりません）', { bass: chord?.bassName ?? '' })}{' '}
              <button type="button" className="link" onClick={() => setIgnoreBass(false)}>
                {t('元に戻す')}
              </button>
            </p>
          )}
          <div className="gv-selected">
            <span data-testid="gv-pitches">{form ? t('選択フォーム: {notes}', { notes: pitchNames(pitches) }) : t('フォーム未選択')}</span>
            <button type="button" onClick={() => preview.play(pitches)} disabled={!form || !preview.ready} title={!preview.ready ? t('音源が読み込まれていないため試聴できません') : undefined} data-testid="gv-preview">
              ♪ {t('試聴')}
            </button>
          </div>
        </fieldset>

        <div className="gv-place-row">
          <label>
            {t('挿入位置')}
            <input type="text" value={tickText} onChange={(e) => setTickText(e.target.value)} className="gv-pos-input" data-testid="gv-tick" spellCheck={false} />
          </label>
          <label>
            {t('長さ')}
            <select value={lengthMode} onChange={(e) => setLengthMode(e.target.value as LengthMode)} data-testid="gv-length-mode">
              {lengthOptions.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {lengthMode === 'custom' ? (
            <label>
              {t('Tick')}
              <NumberInput min={1} max={project.ppq * 4 * 64} value={customLength} onValue={setCustomLength} data-testid="gv-length-ticks" />
            </label>
          ) : (
            <span className="note gv-length-ticks" data-testid="gv-length">
              {t('{n} Tick', { n: length })}
            </span>
          )}
          <TargetSelect value={target} onChange={setTarget} />
        </div>
        {overlaps > 0 && !reason && <p className="note gv-warn">{t('挿入先のこの範囲には既存のノートが {n} 個あります（置き換えずに重ねて入れます）', { n: overlaps })}</p>}
        <div className="row">
          <button type="submit" className="primary" disabled={!!reason} title={reason ?? undefined} data-testid="gv-insert">
            {t('挿入')}
          </button>
          <button type="button" onClick={onClose}>
            {t('キャンセル')}
          </button>
          {reason && reason !== chordProblem && (
            <span className="note" data-testid="gv-reason">
              {reason}
            </span>
          )}
        </div>
      </form>
    </Dialog>
  );
}
