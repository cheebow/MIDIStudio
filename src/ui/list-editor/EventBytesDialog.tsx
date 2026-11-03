// SysEx / Meta editor for the list (ADR-066): insert, edit or convert rows whose content does not
// fit in one cell. SysEx can be built from the GS parameter table (checksum computed) or typed as
// hex; meta events take a type and text (UTF-8) or hex. Tempo / time / key / marker metas belong
// to the conductor track and are refused here.
import { useMemo, useState } from 'react';
import { t } from '../../i18n';
import { Dialog } from '../Dialog';
import { HexBytesField, hexFieldState, toHex } from '../inspector/HexBytesField';
import { useEditorState, useServices } from '../../app/store/context';
import { base64ToBytes, bytesToBase64 } from '../../core/model/base64';
import { decodeGs, GS_PARAMS, type GsCategory, type GsParamDef } from '../../core/gs/gsSysex';
import { META_NAMES } from '../../core/list/listRows';
import { gsSysExTemplate, insertListEvent, metaBytesToText, metaTemplate, RESERVED_META, setMetaEvent, setSysExEvent, textToMetaBytes } from '../../core/list/listInsert';
import { convertEventKinds } from '../../core/list/listConvert';
import type { Command } from '../../core/editing/history';

export type BytesDialogState = { mode: 'insert'; kind: 'sysex' | 'meta'; tick: number } | { mode: 'edit'; id: string } | { mode: 'convert'; ids: string[]; kind: 'sysex' | 'meta' };

const CATEGORY_LABEL: Record<GsCategory, string> = { system: 'System', reverb: 'Reverb', chorus: 'Chorus', delay: 'Delay', part: 'Part' };

/** last GS template used in this session (not saved with the song) */
const memory: { gs: { name: string; channel: number; value: number } | null } = { gs: null };
const rememberGs = (v: { name: string; channel: number; value: number }) => {
  memory.gs = v;
};

export function EventBytesDialog({ state, trackId, onClose, onDone }: { state: BytesDialogState; trackId: string; onClose: () => void; onDone: (ids: string[]) => void }) {
  const { store, reportError } = useServices();
  const { project } = useEditorState();
  const track = project.tracks.find((x) => x.id === trackId);
  const editing = state.mode === 'edit' ? project.tracks.flatMap((x) => x.events).find((e) => e.id === state.id) : undefined;
  const kind: 'sysex' | 'meta' = state.mode === 'edit' ? (editing?.kind === 'meta' ? 'meta' : 'sysex') : state.kind;
  const initialBytes = editing && (editing.kind === 'sysex' || editing.kind === 'meta') ? Array.from(base64ToBytes(editing.dataBase64) ?? []) : null;
  const initialGs = kind === 'sysex' && !initialBytes ? (memory.gs ?? { name: 'Master Volume', channel: track?.channel ?? 0, value: 100 }) : null;

  const [status, setStatus] = useState<'F0' | 'F7'>(editing?.kind === 'sysex' ? editing.status : 'F0');
  const [search, setSearch] = useState('');
  const [tpl, setTpl] = useState<string>(initialGs?.name ?? '');
  const [channel, setChannel] = useState(initialGs?.channel ?? track?.channel ?? 0);
  const [value, setValue] = useState(initialGs?.value ?? 100);
  const [hex, setHex] = useState(() => {
    if (initialBytes) return toHex(initialBytes);
    if (initialGs) {
      const p = GS_PARAMS.find((x) => x.name === initialGs.name);
      const ev = p ? gsSysExTemplate(p, Math.max(p.min, Math.min(p.max, initialGs.value)), 0, initialGs.channel) : null;
      return ev && ev.kind === 'sysex' ? toHex(base64ToBytes(ev.dataBase64) ?? []) : '';
    }
    return '';
  });
  const initialText = kind === 'meta' && initialBytes ? metaBytesToText(initialBytes) : '';
  const [metaType, setMetaType] = useState(editing?.kind === 'meta' ? editing.metaType : 0x01);
  const [metaOther, setMetaOther] = useState(editing?.kind === 'meta' && META_NAMES[editing.metaType] === undefined ? editing.metaType : 0x7f);
  const [dataMode, setDataMode] = useState<'text' | 'hex'>(kind === 'meta' && initialBytes && initialText === null ? 'hex' : 'text');
  const [text, setText] = useState(initialText ?? '');

  const params = useMemo(() => GS_PARAMS.filter((p) => p.max > p.min || p.name === 'GS Reset').filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase())), [search]);
  const param: GsParamDef | undefined = GS_PARAMS.find((p) => p.name === tpl);
  const decoded = kind === 'sysex' && status === 'F0' ? decodeGs(hexFieldState(hex, true).bytes ?? []) : null;

  const regenerate = (p: GsParamDef | undefined, ch: number, v: number) => {
    if (!p) return;
    const clamped = Math.max(p.min, Math.min(p.max, v));
    const ev = gsSysExTemplate(p, clamped, 0, ch);
    if (ev.kind === 'sysex') setHex(toHex(base64ToBytes(ev.dataBase64) ?? []));
    setStatus('F0');
  };

  const metaTypeValue = META_NAMES[metaType] === undefined ? 'other' : String(metaType);
  const effectiveMetaType = metaTypeValue === 'other' ? metaOther : metaType;

  function apply() {
    try {
      let cmd: Command | null = null;
      let ids: string[] = [];
      if (kind === 'sysex') {
        const s = hexFieldState(hex, status === 'F0');
        if (!s.bytes) return reportError(s.error);
        if (param && decoded?.param?.name === param.name) rememberGs({ name: param.name, channel, value });
        if (state.mode === 'insert') {
          const r = insertListEvent(project, trackId, { kind: 'sysex', tick: state.tick, status, dataBase64: bytesToBase64(s.bytes) });
          if (r) ({ command: cmd, ids } = r);
        } else if (state.mode === 'edit') cmd = setSysExEvent(project, state.id, { status, bytes: s.bytes });
        else cmd = convertEventKinds(project, state.ids, { kind: 'sysex', status, bytes: s.bytes });
      } else {
        let bytes: number[];
        if (dataMode === 'text') bytes = textToMetaBytes(text);
        else {
          const s = hexFieldState(hex, false);
          if (!s.bytes) return reportError(s.error);
          bytes = s.bytes;
        }
        if (state.mode === 'insert') {
          const r = insertListEvent(project, trackId, metaTemplate(effectiveMetaType, bytes, state.tick));
          if (r) ({ command: cmd, ids } = r);
        } else if (state.mode === 'edit') cmd = setMetaEvent(project, state.id, { metaType: effectiveMetaType, bytes });
        else {
          if (RESERVED_META.has(effectiveMetaType)) throw new Error(t('テンポ・拍子・調号・マーカーはコンダクタートラックで編集します（リストには置けません）。'));
          cmd = convertEventKinds(project, state.ids, { kind: 'meta', metaType: effectiveMetaType, bytes });
        }
      }
      onDone(ids); // before the store update: the list picks the new row up on that very render
      if (cmd) store.run(cmd, ids.length ? { select: ids } : {});
      onClose();
    } catch (e) {
      reportError((e as Error).message);
    }
  }

  const title = kind === 'sysex' ? (state.mode === 'insert' ? t('SysEx を挿入') : state.mode === 'edit' ? t('SysEx を編集') : t('SysEx に変更')) : state.mode === 'insert' ? t('Meta を挿入') : state.mode === 'edit' ? t('Meta を編集') : t('Meta に変更');
  const metaTypes = Object.keys(META_NAMES).map(Number).filter((n) => !RESERVED_META.has(n));

  return (
    <Dialog title={title} onClose={onClose}>
      <form
        className="form-grid quantize-form"
        data-testid="event-bytes-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        {kind === 'sysex' ? (
          <>
            <fieldset>
              <legend>{t('GS テンプレート')}</legend>
              <label>
                {t('検索')} <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('名前の一部')} aria-label={t('テンプレートを検索')} />
              </label>
              <label>
                {t('パラメーター')}{' '}
                <select
                  value={param && params.includes(param) ? tpl : ''}
                  aria-label={t('GS パラメーター')}
                  data-testid="gs-template"
                  onChange={(e) => {
                    const p = GS_PARAMS.find((x) => x.name === e.target.value);
                    setTpl(e.target.value);
                    if (p) {
                      const v = Math.max(p.min, Math.min(p.max, value));
                      setValue(v);
                      regenerate(p, channel, v);
                    }
                  }}
                >
                  <option value="">{t('（手入力）')}</option>
                  {(['system', 'reverb', 'chorus', 'delay', 'part'] as GsCategory[]).map((c) => {
                    const group = params.filter((p) => p.category === c);
                    return group.length ? (
                      <optgroup key={c} label={CATEGORY_LABEL[c]}>
                        {group.map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.name}
                            {p.engine ? '' : t('（内蔵音源は未対応）')}
                          </option>
                        ))}
                      </optgroup>
                    ) : null;
                  })}
                </select>
              </label>
              {param && param.category === 'part' && (
                <label>
                  {t('チャンネル')}{' '}
                  <select
                    value={channel}
                    aria-label={t('チャンネル')}
                    onChange={(e) => {
                      const ch = Number(e.target.value);
                      setChannel(ch);
                      regenerate(param, ch, value);
                    }}
                  >
                    {Array.from({ length: 16 }, (_, i) => (
                      <option key={i} value={i}>
                        {i + 1}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {param && param.max > param.min && (
                <label>
                  {t('値')}（{param.min}〜{param.max}）{' '}
                  <input
                    type="number"
                    min={param.min}
                    max={param.max}
                    value={value}
                    aria-label={t('値')}
                    data-testid="gs-value"
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setValue(v);
                      if (Number.isInteger(v) && v >= param.min && v <= param.max) regenerate(param, channel, v);
                    }}
                  />
                  {param.format && Number.isInteger(value) && value >= param.min && value <= param.max && <span className="note">{param.format(value)}</span>}
                </label>
              )}
            </fieldset>
            <fieldset>
              <legend>{t('バイト列')}</legend>
              <label>
                <input type="radio" name="sysex-status" checked={status === 'F0'} onChange={() => setStatus('F0')} /> F0（{t('通常の SysEx')}）
              </label>
              <label>
                <input type="radio" name="sysex-status" checked={status === 'F7'} onChange={() => setStatus('F7')} /> F7（{t('続き / エスケープ')}）
              </label>
              <HexBytesField value={hex} onChange={setHex} sysex={status === 'F0'} label={status === 'F0' ? t('F0 の後ろから（F7 で終わる）') : t('データ（16進）')} testId="sysex-hex" />
            </fieldset>
          </>
        ) : (
          <>
            <fieldset>
              <legend>{t('種類')}</legend>
              <label>
                <select
                  value={metaTypeValue}
                  aria-label={t('メタイベントの種類')}
                  data-testid="meta-type"
                  onChange={(e) => {
                    if (e.target.value === 'other') setMetaType(metaOther);
                    else setMetaType(Number(e.target.value));
                  }}
                >
                  {metaTypes.map((n) => (
                    <option key={n} value={String(n)}>
                      {META_NAMES[n]}（FF {n.toString(16).toUpperCase().padStart(2, '0')}）
                    </option>
                  ))}
                  <option value="other">{t('その他（番号を指定）')}</option>
                </select>
              </label>
              {metaTypeValue === 'other' && (
                <label>
                  {t('番号（0〜127）')}{' '}
                  <input
                    type="number"
                    min={0}
                    max={127}
                    value={metaOther}
                    onChange={(e) => {
                      const n = Math.max(0, Math.min(127, Number(e.target.value) || 0));
                      setMetaOther(n);
                      setMetaType(n);
                    }}
                  />
                </label>
              )}
              <span className="note">{t('テンポ・拍子・調号・マーカーはコンダクタートラックで編集します。')}</span>
            </fieldset>
            <fieldset>
              <legend>{t('データ')}</legend>
              <label>
                <input type="radio" name="meta-data" checked={dataMode === 'text'} onChange={() => setDataMode('text')} /> {t('テキスト（UTF-8）')}
              </label>
              <label>
                <input type="radio" name="meta-data" checked={dataMode === 'hex'} onChange={() => setDataMode('hex')} /> {t('16進')}
              </label>
              {dataMode === 'text' ? (
                <input value={text} onChange={(e) => setText(e.target.value)} aria-label={t('テキスト')} data-testid="meta-text" />
              ) : (
                <HexBytesField value={hex} onChange={setHex} sysex={false} testId="meta-hex" />
              )}
            </fieldset>
          </>
        )}
        <div className="row">
          <button type="submit" className="primary" data-testid="event-bytes-apply">
            {state.mode === 'insert' ? t('挿入') : t('適用')}
          </button>
          <button type="button" onClick={onClose}>
            {t('キャンセル')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
