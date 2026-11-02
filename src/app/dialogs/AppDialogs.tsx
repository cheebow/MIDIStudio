// The app-level dialogs (one open at a time), rendered from App's `dialog` state.
import type { ImportIssue } from '../../core/smf/types';
import type { BrowserFeatures } from '../../playback/featureDetect';
import type { MidiInputAdapter } from '../../input/MidiInputAdapter';
import type { ProjectSummary } from '../../storage/indexedDb';
import { Dialog } from '../../ui/Dialog';
import { KeyBindings } from '../../ui/settings/KeyBindings';
import { MidiInputSettings } from '../../ui/recording/MidiInputSettings';
import { RecordSettingsForm } from '../../ui/recording/RecordSettings';
import { SysExInspector } from '../../ui/inspector/SysExInspector';
import { QuantizeDialog } from '../../ui/editing/QuantizeDialog';
import { HumanizeDialog } from '../../ui/editing/HumanizeDialog';
import { VelocityDialog } from '../../ui/editing/VelocityDialog';
import { ExportWavDialog } from '../../ui/export/ExportWavDialog';
import { useEditorState, useServices } from '../store/context';
import { AboutDialog } from './HelpDialogs';
import { HelpDialog } from '../help/HelpDialog';
import { TUTORIAL_CHAPTERS } from '../help/tutorial';

export type DialogKind = null | 'issues' | 'recent' | 'shortcuts' | 'about' | 'compat' | 'diagnostics' | 'keys' | 'record' | 'midi' | 'sysex' | 'quantize' | 'humanize' | 'velocity' | 'wav' | 'help' | 'tutorial' | { confirm: string; onYes: () => void };

export function AppDialogs({ dialog, setDialog, issues, recent, openRecent, midi, onMidiChange, features, soundFont }: { dialog: DialogKind; setDialog: (d: DialogKind) => void; issues: ImportIssue[]; recent: ProjectSummary[]; openRecent: (id: string) => void; midi: MidiInputAdapter; onMidiChange: () => void; features: BrowserFeatures; soundFont: ArrayBuffer | null }) {
  const { store, input, adapter } = useServices();
  const { project } = useEditorState();
  const close = () => setDialog(null);
  if (!dialog) return null;
  if (typeof dialog === 'object') {
    return (
      <Dialog title="確認" onClose={close}>
        <p style={{ whiteSpace: 'pre-line' }}>{dialog.confirm}</p>
        <div className="row">
          <button className="primary" onClick={() => (close(), dialog.onYes())} data-testid="confirm-yes">
            はい
          </button>
          <button onClick={close}>キャンセル</button>
        </div>
      </Dialog>
    );
  }
  switch (dialog) {
    case 'issues':
      return (
        <Dialog title="読み込み時の注意" onClose={close}>
          <ul className="issues">
            {issues.map((i, k) => (
              <li key={k} data-severity={i.severity}>
                {i.message}
              </li>
            ))}
          </ul>
        </Dialog>
      );
    case 'recent':
      return (
        <Dialog title="最近のプロジェクト（このブラウザ内）" onClose={close}>
          {recent.length === 0 ? (
            <p className="note">保存された曲はありません。</p>
          ) : (
            <ul className="saved-list">
              {recent.map((r) => (
                <li key={r.id}>
                  <button onClick={() => openRecent(r.id)}>{r.title}</button> <span className="note">{new Date(r.savedAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      );
    case 'record':
      return (
        <Dialog title="録音の設定" onClose={close}>
          <RecordSettingsForm value={project.settings.recording} onChange={(v) => store.updateSettings({ recording: v })} />
          <p className="note">録音先は R（録音待機）を押したトラックです。鍵盤用とドラム用にそれぞれ 1 トラックまで。録音は停止時に 1 回の操作として記録され、Undo で戻せます。</p>
        </Dialog>
      );
    case 'midi':
      return (
        <Dialog title="MIDI 入力の設定" onClose={close}>
          <MidiInputSettings midi={midi} input={input} onChange={onMidiChange} />
        </Dialog>
      );
    case 'sysex':
      return (
        <Dialog title="SysEx / イベントインスペクター" onClose={close}>
          <SysExInspector />
        </Dialog>
      );
    case 'quantize':
      return <QuantizeDialog onClose={close} />;
    case 'humanize':
      return <HumanizeDialog onClose={close} />;
    case 'velocity':
      return <VelocityDialog onClose={close} />;
    case 'wav':
      return <ExportWavDialog soundFont={soundFont} onClose={close} />;
    case 'keys':
      return (
        <Dialog title="キー割り当て" onClose={close}>
          <KeyBindings presets={project.inputPresets} onChange={(p) => store.setInputPresets(p)} />
        </Dialog>
      );
    case 'help':
      return <HelpDialog onClose={close} />;
    case 'tutorial':
      return <HelpDialog title="入門" sections={TUTORIAL_CHAPTERS} testId="tutorial-dialog" onClose={close} />;
    case 'shortcuts':
      return <HelpDialog section="shortcuts" onClose={close} />;
    case 'compat':
      return <HelpDialog section="gm-gs" onClose={close} />;
    case 'about':
      return <AboutDialog onClose={close} />;
    case 'diagnostics':
      return (
        <Dialog title="プロジェクト診断" onClose={close}>
          <ul className="features">
            <li data-ok={String(features.audioWorklet)}>AudioWorklet: {features.audioWorklet ? '利用可' : '利用不可'}</li>
            <li data-ok={String(features.webMidi)}>Web MIDI: {features.webMidi ? '利用可' : '利用不可'}</li>
            <li data-ok={String(features.indexedDb)}>IndexedDB: {features.indexedDb ? '利用可' : '利用不可'}</li>
          </ul>
          <p>
            PPQ {project.ppq} / トラック {project.tracks.length} / イベント {project.tracks.reduce((n, t) => n + t.events.length, 0)} / テンポ・拍子等 {project.conductor.length}
          </p>
          <p>raw として保持しているイベント: {project.tracks.reduce((n, t) => n + t.events.filter((e) => e.kind === 'raw').length, 0)} 件</p>
          <p data-testid="synth-channels">音源のチャンネル数: {adapter.channelCount || '（音源未起動）'}</p>
          {issues.length > 0 && <button onClick={() => setDialog('issues')}>直前の読み込み時の注意（{issues.length} 件）</button>}
        </Dialog>
      );
  }
}
