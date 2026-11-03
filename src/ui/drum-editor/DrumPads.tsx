// On-screen drum pads (INPUT_RECORDING 3): usable with mouse / touch, lit by keyboard input too.
import { useSyncExternalStore } from 'react';
import { t } from '../../i18n';
import { drumName, type DrumMap } from '../../core/gm/drumMaps';
import { keyLabel } from '../../input/keyLabels';
import { drumColor } from '../drumColors';
import { useEditorState, useServices } from '../../app/store/context';

/** Pad slots are drum pitches (3x3 kit layout first); keys are labels of whatever is assigned. */
const SLOT_ORDER = [49, 51, 46, 45, 47, 50, 36, 38, 42];

export function DrumPads({ map }: { map: DrumMap }) {
  const { input } = useServices();
  const { project } = useEditorState();
  const snap = useSyncExternalStore(input.subscribe, input.getSnapshot);
  const presets = project.inputPresets;
  const layout = presets.layout;
  return (
    <div className="drum-pads" aria-label={t('ドラムパッド')}>
      <div className="pad-grid">
        {[...new Set([...SLOT_ORDER, ...Object.values(presets.drumPadKeys), ...Object.values(presets.numpadKeys)])].map((pitch) => {
          const keys = [...Object.entries(presets.drumPadKeys), ...Object.entries(presets.numpadKeys)].filter(([, p]) => p === pitch).map(([code]) => keyLabel(code, layout));
          return (
            <button
              key={pitch}
              className={`pad${snap.drumHeld.has(pitch) ? ' on' : ''}`}
              style={{ borderLeft: `5px solid ${drumColor(map, pitch)}` }}
              data-testid={`pad-${pitch}`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                input.padDown(pitch, presets.defaultVelocity);
              }}
              onPointerUp={() => input.padUp(pitch)}
              onPointerCancel={() => input.padUp(pitch)}
            >
              <span className="pad-name">{drumName(map, pitch)}</span>
              <span className="pad-keys">{keys.length ? keys.join(' / ') : t('（キーなし）')}</span>
            </button>
          );
        })}
      </div>
      <p className="note">
        {snap.mode === 'drum-performance' ? t('ドラムパッドモード: 文字キー・テンキーで演奏できます。') : t('パッドはクリックで試聴できます。キーで演奏するには入力モードを「ドラムパッド」にしてください。')}
      </p>
    </div>
  );
}
