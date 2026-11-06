// Chord-box diagram of a guitar form (ADR-091): strings 6 → 1 from left to right (numbered under the
// box), fret numbers to the left of each row, × for a muted string and ○ for an open one above the
// box, dots on the pressed frets. Near the nut the top line is the thick nut; higher up the rows start
// at the lowest pressed fret (its number is the first one on the left).
import { diagramBaseFret } from '../../core/guitar/voicing';

const LEFT = 22;
const TOP = 16;
const STRING_GAP = 12;
const FRET_GAP = 14;
const FRETS = 5;
const W = LEFT + 5 * STRING_GAP + 10;
const H = TOP + FRETS * FRET_GAP + 14;

export function GuitarDiagram({ frets, label }: { frets: readonly number[]; label: string }) {
  const base = diagramBaseFret(frets);
  // rows drawn are frets first..first+4 (near the nut: 1..5)
  const first = base === 0 ? 1 : base;
  const x = (s: number) => LEFT + s * STRING_GAP;
  const y = (row: number) => TOP + row * FRET_GAP;
  return (
    <svg className="guitar-diagram" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
      <line stroke="currentColor" x1={x(0)} x2={x(5)} y1={y(0)} y2={y(0)} className={base === 0 ? 'gd-nut' : 'gd-fret'} />
      {Array.from({ length: FRETS }, (_, i) => (
        <g key={`f${i}`}>
          <line stroke="currentColor" x1={x(0)} x2={x(5)} y1={y(i + 1)} y2={y(i + 1)} className="gd-fret" />
          <text x={LEFT - 6} y={y(i) + FRET_GAP / 2 + 3} className={`gd-num${frets.includes(first + i) ? ' used' : ''}`} textAnchor="end">
            {first + i}
          </text>
        </g>
      ))}
      {Array.from({ length: 6 }, (_, s) => (
        <g key={`s${s}`}>
          <line stroke="currentColor" x1={x(s)} x2={x(s)} y1={y(0)} y2={y(FRETS)} className="gd-string" />
          <text x={x(s)} y={H - 2} className="gd-num" textAnchor="middle">
            {6 - s}
          </text>
        </g>
      ))}
      {frets.map((f, s) =>
        f < 0 ? (
          <text key={`m${s}`} x={x(s)} y={TOP - 4} className="gd-mark" textAnchor="middle">
            ×
          </text>
        ) : f === 0 ? (
          <circle key={`o${s}`} cx={x(s)} cy={TOP - 7} r={3} className="gd-open" />
        ) : (
          <circle key={`d${s}`} cx={x(s)} cy={y(f - first) + FRET_GAP / 2} r={4.4} className="gd-dot" />
        ),
      )}
    </svg>
  );
}
