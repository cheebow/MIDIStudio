// Modal dialog built on <dialog> (focus trap, Esc to close). No browser alert/confirm.
// `closable: false` removes the × and ignores Esc (the startup dialog has to be answered);
// `header` replaces the title bar (the startup dialog shows the logo there).
import { useEffect, useRef, type ReactNode } from 'react';

export function Dialog({ title, onClose, children, closable = true, header }: { title: string; onClose: () => void; children: ReactNode; closable?: boolean; header?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-label={title}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        if (closable) onClose();
      }}
    >
      {header ?? (
        <header>
          <h2>{title}</h2>
          {closable && (
            <button aria-label="閉じる" onClick={onClose}>
              ×
            </button>
          )}
        </header>
      )}
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
