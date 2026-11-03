// Input-mode switch in the toolbar (INPUT_RECORDING 7, ADR-044): one visible control that says
// whether the letter keys are shortcuts or an instrument (one highlight colour for every mode), so
// "why does V not select?" is answered by the status bar; Esc and ⌥K / ⌥R switch without the mouse.
import type { InputMode } from '../input/KeyboardRouter';
import { useContextMenu } from '../ui/menu/ContextMenu';
import { ALT_LABEL } from '../ui/platform';
import { t } from '../i18n';

const PERFORMING: ReadonlySet<InputMode> = new Set(['piano-performance', 'drum-performance']);
const STEP: ReadonlySet<InputMode> = new Set(['step-piano', 'step-drums']);

export function InputModeSwitch({ mode, setMode, drumTrack }: { mode: InputMode; setMode: (m: InputMode) => void; drumTrack: boolean }) {
  const ctx = useContextMenu();
  const performing = PERFORMING.has(mode);
  const button = (m: InputMode, label: string, title: string, key?: string) => (
    <button type="button" className={mode === m ? 'on' : ''} aria-pressed={mode === m} title={title} onClick={() => setMode(m)} data-testid={`input-mode-${m}`}>
      {label}
      {key && <kbd className="mode-key">{key}</kbd>}
    </button>
  );
  return (
    <span className={`segmented input-mode-switch${performing ? ' performing' : ''}`} role="group" aria-label={t('入力モード')} title={performing ? t('文字キーは演奏に使われています。1 文字のショートカットは無効です。') : t('文字キーはショートカットとして働きます。')}>
      {button('edit-shortcuts', t('編集'), t('編集モード: 文字キーはショートカット（V / P / Q / L / M / S など）。どのモードからも Esc で戻ります。'), 'Esc')}
      {button('piano-performance', t('鍵盤'), t('PC 鍵盤で演奏（{alt}K で切り替え）: 下段 Z〜M が C4〜B4、上段 Q〜I が C5〜C6。1 文字のショートカットは無効になります。', { alt: ALT_LABEL }), `${ALT_LABEL}K`)}
      {button('drum-performance', t('パッド'), t('ドラムパッド（{alt}R で切り替え）: 文字キーとテンキーで叩きます。1 文字のショートカットは無効になります。', { alt: ALT_LABEL }), `${ALT_LABEL}R`)}
      <button
        type="button"
        className={STEP.has(mode) ? 'on' : ''}
        aria-pressed={STEP.has(mode)}
        aria-haspopup="menu"
        title={t('ステップ入力: 鍵盤かドラムを選びます。→ で休符、← で戻る、- でタイ、Backspace で直前を取り消し')}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          ctx.open({ clientX: r.left, clientY: r.bottom + 2, preventDefault: () => undefined }, [
            { label: t('ステップ（鍵盤）'), checked: mode === 'step-piano', action: () => setMode('step-piano') },
            { label: drumTrack ? t('ステップ（ドラム）') : t('ステップ（ドラム）— 選択中はドラムトラックではありません'), checked: mode === 'step-drums', action: () => setMode('step-drums') },
          ]);
        }}
        data-testid="input-mode-step"
      >
        {t('ステップ ▾')}
      </button>
      {ctx.element}
    </span>
  );
}
