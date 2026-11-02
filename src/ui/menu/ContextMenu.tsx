// Right-click (context) menu: opened at the pointer, closed by Esc, an outside click, scroll or
// choosing an item. Uses the same item shape as the menu bar.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MenuList, type MenuItem } from './MenuBar';
import { IS_MAC } from '../platform';

interface OpenMenu {
  x: number;
  y: number;
  items: MenuItem[];
}


/** Right button, or Ctrl+click on macOS (which also opens the context menu). Pointer handlers skip these. */
export function isSecondaryClick(e: { button: number; ctrlKey: boolean }): boolean {
  return e.button !== 0 || (IS_MAC && e.ctrlKey);
}

export function useContextMenu(): { open: (e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[]) => void; element: ReactNode } {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof PointerEvent && ref.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenu(null);
      }
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  // after the first paint: pull the menu back inside the window when it would overflow the right / bottom edge
  useLayoutEffect(() => {
    const el = ref.current;
    if (!menu || !el) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) el.style.left = `${Math.max(8, window.innerWidth - 8 - r.width)}px`;
    if (r.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, window.innerHeight - 8 - r.height)}px`;
  }, [menu]);

  const open = (e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[]) => {
    e.preventDefault();
    // keep the menu inside the window
    const x = Math.min(e.clientX, window.innerWidth - 240);
    const y = Math.min(e.clientY, window.innerHeight - Math.min(items.length * 28 + 12, window.innerHeight - 10));
    setMenu({ x, y, items });
  };

  const element = menu ? (
    <div ref={ref} className="context-menu-root" style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 200 }} data-testid="context-menu">
      <MenuList items={menu.items} onClose={() => setMenu(null)} autoFocusFirst style={{ position: 'static' }} />
    </div>
  ) : null;

  return { open, element };
}
