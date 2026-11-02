// Horizontal splitter bar: drag to resize the area below it, double-click to collapse / expand.
import { useRef } from 'react';

export function Splitter({ height, min, max, onResize, onToggle, label }: { height: number; min: number; max: number; onResize: (h: number) => void; onToggle: () => void; label: string }) {
  const start = useRef<{ y: number; h: number } | null>(null);
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuenow={Math.round(height)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="ドラッグで高さを変更、ダブルクリックで折り畳み / 展開"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { y: e.clientY, h: height };
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        onResize(Math.round(Math.max(min, Math.min(max, start.current.h - (e.clientY - start.current.y)))));
      }}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
      onDoubleClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') onResize(Math.min(max, height + 20));
        else if (e.key === 'ArrowDown') onResize(Math.max(min, height - 20));
        else if (e.key === 'Enter') onToggle();
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    />
  );
}
