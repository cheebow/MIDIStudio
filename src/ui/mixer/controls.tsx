// Mixer controls: a simple rotary knob and a vertical fader (0..127 MIDI values).
// Both: drag (vertical), mouse wheel, arrow / Page / Home / End keys, double-click = default.
// `onChange` fires while moving (live preview), `onCommit` once when the gesture ends.
import { useRef, useState } from 'react';

interface ValueProps {
  value: number | null; // null = not set in the song (shown dimmed at the default)
  /** tooltip shown with an "A" mark when the controller changes during the song */
  automation?: string;
  defaultValue: number;
  label: string;
  onChange: (v: number) => void;
  /** `mergeKey`: commits with the same key are one undo step (a burst of wheel ticks) */
  onCommit: (v: number, mergeKey?: string) => void;
}

/** a pause this long between wheel ticks starts a new undo step */
const WHEEL_IDLE_MS = 600;
let wheelSessions = 0;

const clamp = (v: number) => Math.max(0, Math.min(127, Math.round(v)));

/** pxPerStep: drag distance per value step (a function so a fader can follow its track height). */
function useValueGestures({ value, defaultValue, onChange, onCommit }: ValueProps, pxPerStep: number | (() => number)) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const [live, setLive] = useState<number | null>(null);
  // The live value is also kept in a ref: pointerup / keyup can arrive before React has re-rendered
  // after the last pointermove / keydown (seen on Firefox under load), and the handlers would then
  // read a stale `live` and commit the value the drag started from.
  const liveRef = useRef<number | null>(null);
  const current = live ?? value ?? defaultValue;
  /** value to step from: repeated keys / wheel ticks can arrive before React re-rendered `current` */
  const base = () => liveRef.current ?? value ?? defaultValue;
  const set = (v: number) => {
    const c = clamp(v);
    liveRef.current = c;
    setLive(c);
    onChange(c);
    return c;
  };
  const commit = (v: number, mergeKey?: string) => {
    liveRef.current = null;
    setLive(null);
    onCommit(clamp(v), mergeKey);
  };
  const wheel = useRef<{ key: string; at: number } | null>(null);
  /** ends a drag: pointerup, or a lost capture / cancel (window blur mid-drag) so the drag never sticks (ADR-084) */
  const endDrag = () => {
    if (!drag.current) return;
    const l = liveRef.current;
    const v = l ?? drag.current.v;
    drag.current = null;
    if (l !== null || v !== (value ?? defaultValue)) commit(v);
  };
  const startDrag = (e: React.PointerEvent, from: number) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    (e.currentTarget as HTMLElement).focus();
    drag.current = { y: e.clientY, v: from };
  };
  return {
    current,
    set,
    startDrag,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => startDrag(e, current),
      onPointerMove: (e: React.PointerEvent) => {
        if (!drag.current) return;
        const fine = e.shiftKey ? 0.25 : 1;
        const px = typeof pxPerStep === 'function' ? pxPerStep() : pxPerStep;
        set(drag.current.v + ((drag.current.y - e.clientY) / px) * fine);
      },
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onLostPointerCapture: endDrag,
      onDoubleClick: () => commit(set(defaultValue)),
      onWheel: (e: React.WheelEvent) => {
        const v = set(base() + (e.deltaY < 0 ? 1 : -1));
        // one undo step per burst of wheel ticks, not one per tick (ADR-084)
        const now = performance.now();
        if (!wheel.current || now - wheel.current.at > WHEEL_IDLE_MS) wheel.current = { key: `wheel-${++wheelSessions}`, at: now };
        wheel.current.at = now;
        commit(v, wheel.current.key);
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        const step: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
        if (e.key in step) set(base() + step[e.key]);
        else if (e.key === 'Home') set(0);
        else if (e.key === 'End') set(127);
        else return;
        e.preventDefault();
        e.stopPropagation();
      },
      onKeyUp: (e: React.KeyboardEvent) => {
        const l = liveRef.current;
        if (l !== null && ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) commit(l);
      },
    },
  };
}

/** Rotary knob. `bipolar` draws the arc from the centre (pan). */
export function Knob(props: ValueProps & { bipolar?: boolean; format?: (v: number) => string; color: string }) {
  const { current, handlers } = useValueGestures(props, 2);
  const unset = props.value === null;
  const a0 = -135;
  const a1 = 135;
  const angle = a0 + (current / 127) * (a1 - a0);
  const arc = (from: number, to: number) => {
    const r = 15;
    const p = (deg: number) => [20 + r * Math.sin((deg * Math.PI) / 180), 20 - r * Math.cos((deg * Math.PI) / 180)];
    const [x0, y0] = p(Math.min(from, to));
    const [x1, y1] = p(Math.max(from, to));
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  };
  const start = props.bipolar ? 0 : a0;
  return (
    <div className={`knob${unset ? ' unset' : ''}`}>
      <svg
        viewBox="0 0 40 40"
        width="40"
        height="40"
        role="slider"
        tabIndex={0}
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={127}
        aria-valuenow={current}
        aria-valuetext={props.format ? props.format(current) : String(current)}
        {...handlers}
      >
        <path d={arc(a0, a1)} className="knob-track" />
        {current !== (props.bipolar ? 64 : 0) && <path d={arc(start, angle)} className="knob-value" style={{ stroke: props.color }} />}
        <circle cx="20" cy="20" r="10.5" className="knob-body" />
        <line x1="20" y1="20" x2={20 + 9 * Math.sin((angle * Math.PI) / 180)} y2={20 - 9 * Math.cos((angle * Math.PI) / 180)} className="knob-pointer" />
      </svg>
      {props.automation && (
        <span className="auto-mark knob-auto" title={props.automation}>
          A
        </span>
      )}
      <span className="knob-label">{props.label.split(' ').pop()}</span>
      <span className="knob-value-text">{unset ? '--' : props.format ? props.format(current) : current}</span>
    </div>
  );
}

/** Vertical fader with a 0..127 scale. */
export function Fader(props: ValueProps & { color: string; meter?: React.ReactNode }) {
  const trackRef = useRef<HTMLDivElement>(null);
  // the thumb follows the pointer: one value step = track height / 127
  const { current, handlers, set, startDrag } = useValueGestures(props, () => Math.max(0.3, (trackRef.current?.clientHeight ?? 127) / 127));
  const unset = props.value === null;
  const pct = (current / 127) * 100;
  return (
    <div className={`fader${unset ? ' unset' : ''}`} title={props.automation}>
      {props.automation && <span className="auto-mark fader-auto">A</span>}
      <div className="fader-scale" aria-hidden="true">
        {[127, 100, 64, 32, 0].map((m) => (
          <span key={m} style={{ bottom: `${(m / 127) * 100}%` }}>
            {m}
          </span>
        ))}
      </div>
      <div
        ref={trackRef}
        className="fader-track"
        role="slider"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={127}
        aria-valuenow={current}
        {...handlers}
        onPointerDown={(e) => {
          // a click on the track (not the thumb) jumps there, then drags from that value
          if ((e.target as HTMLElement).classList.contains('fader-thumb')) return handlers.onPointerDown(e);
          const rect = e.currentTarget.getBoundingClientRect();
          startDrag(e, set(((rect.bottom - e.clientY) / rect.height) * 127));
        }}
      >
        <div className="fader-fill" style={{ height: `${pct}%`, background: props.color }} />
        <div className="fader-thumb" style={{ bottom: `${pct}%` }} />
      </div>
      {props.meter}
    </div>
  );
}
