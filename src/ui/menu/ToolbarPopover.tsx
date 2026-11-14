// A toolbar button that opens a small panel of controls under it (list editor: what is shown, how
// the cells behave). The panel is fixed to the viewport, so a toolbar that scrolls or clips does not
// cut it; a click outside or Esc closes it and gives the focus back to the button.
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function ToolbarPopover({ label, title, active, testId, children }: { label: string; title?: string; active?: boolean; testId?: string; children: ReactNode }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onDown = (e: PointerEvent) => {
      const el = e.target as Node | null;
      if (!panel.current?.contains(el) && !button.current?.contains(el)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      button.current?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
    };
  }, [at]);
  return (
    <>
      <button
        ref={button}
        className={active ? 'on' : ''}
        aria-haspopup="dialog"
        aria-expanded={at !== null}
        title={title}
        data-testid={testId}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt(at ? null : { left: Math.max(4, Math.min(r.left, window.innerWidth - 280)), top: r.bottom + 2 });
        }}
      >
        {label} ▾
      </button>
      {at && (
        <div ref={panel} className="toolbar-popover" role="dialog" aria-label={label} style={{ left: at.left, top: at.top }} data-testid={testId ? `${testId}-panel` : undefined}>
          {children}
        </div>
      )}
    </>
  );
}
