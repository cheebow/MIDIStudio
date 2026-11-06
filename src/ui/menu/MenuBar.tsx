// Menu bar (UI_DESIGN 2). Unavailable items are disabled with the reason as a tooltip. An item
// with `items` is a submenu (ADR-041): it opens on hover / click / →, and closes with ← or when
// another item of the parent menu is hovered. Keyboard: ↑↓ move, Enter activates, Esc closes.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../../i18n';

export interface MenuItem {
  label: string;
  action?: () => void;
  shortcut?: string;
  disabled?: boolean;
  /** why the item is disabled (shown as a tooltip) */
  reason?: string;
  checked?: boolean;
  separator?: boolean;
  /** submenu entries; such an item has no action of its own */
  items?: MenuItem[];
  /** one letter that activates the item while its menu is open (shown after the label) */
  accessKey?: string;
}

export interface Menu {
  label: string;
  items: MenuItem[];
}

/** delay before a hovered item switches the open submenu (lets the pointer cross to the submenu) */
const SUBMENU_HOVER_MS = 120;

export function MenuBar({ menus }: { menus: Menu[] }) {
  const [open, setOpen] = useState<number | null>(null);
  /** opened with the keyboard: the list focuses its first item */
  const [kbd, setKbd] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open === null) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const closeAll = () => setOpen(null);
  return (
    <nav className="menubar" ref={ref} aria-label={t('メニュー')}>
      {menus.map((m, i) => (
        <div className="menu" key={m.label}>
          <button
            className="menu-title"
            aria-haspopup="menu"
            aria-expanded={open === i}
            onClick={() => {
              setKbd(false);
              setOpen(open === i ? null : i);
            }}
            onPointerEnter={() => {
              if (open === null) return;
              setKbd(false);
              setOpen(i);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setKbd(true);
                setOpen(i);
              } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length;
                if (open !== null) setOpen(n);
                (ref.current?.querySelectorAll<HTMLButtonElement>('.menu-title')[n])?.focus();
              }
            }}
          >
            {m.label}
          </button>
          {open === i && <MenuList items={m.items} onClose={closeAll} autoFocusFirst={kbd} onLeft={() => (ref.current?.querySelectorAll<HTMLButtonElement>('.menu-title')[i])?.focus()} />}
        </div>
      ))}
    </nav>
  );
}

/** one level of menu items; renders nested MenuLists for submenus */
const ITEM_BUTTONS = ':scope > button:not(:disabled), :scope > .menu-sub > button:not(:disabled)';

/** width used to decide whether a submenu opens to the right or the left of its parent item */
const SUBMENU_W = 260;

/** fixed-position style for a submenu next to its parent item (the parent list may scroll / clip) */
function submenuStyle(anchor: HTMLElement | null): React.CSSProperties {
  if (!anchor) return {};
  const r = anchor.getBoundingClientRect();
  const left = r.right - 4 + SUBMENU_W <= window.innerWidth ? r.right - 4 : Math.max(0, r.left - SUBMENU_W + 4);
  return { position: 'fixed', left, top: Math.max(0, Math.min(r.top - 5, window.innerHeight - 40)) };
}

export function MenuList({ items, onClose, onLeft, sub = false, autoFocusFirst = false, style, testId }: { items: MenuItem[]; onClose: () => void; onLeft?: () => void; sub?: boolean; autoFocusFirst?: boolean; style?: React.CSSProperties; testId?: string }) {
  /** open submenu: its item index and its fixed position (measured when it opens, not during render) */
  const [openSub, setOpenSubState] = useState<{ k: number; style: React.CSSProperties } | null>(null);
  const subButtons = useRef<Record<number, HTMLButtonElement | null>>({});
  const setOpenSub = (k: number | null) => setOpenSubState(k === null ? null : { k, style: submenuStyle(subButtons.current[k]) });
  const [subKbd, setSubKbd] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);
  useEffect(() => {
    if (autoFocusFirst) listRef.current?.querySelector<HTMLButtonElement>(ITEM_BUTTONS)?.focus();
  }, [autoFocusFirst]);
  // A submenu opened near the bottom of the window is pulled up so its last items stay reachable
  // (the input-assist submenu of a right-click low in the piano roll ran off the screen, ADR-092).
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!sub || !el || el.style.position !== 'fixed') return;
    const r = el.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, window.innerHeight - 8 - r.height)}px`;
  }, [sub]);
  const hover = (k: number | null) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      setSubKbd(false);
      setOpenSub(k);
    }, SUBMENU_HOVER_MS);
  };
  const focusSibling = (dir: 1 | -1) => {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>(ITEM_BUTTONS) ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(i + dir + buttons.length) % buttons.length]?.focus();
  };
  return (
    <div
      ref={listRef}
      className={`menu-items${sub ? ' submenu' : ''}`}
      role="menu"
      style={style}
      data-testid={testId}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          focusSibling(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'ArrowLeft' && onLeft) {
          // submenu: close it and return focus to the parent item; top level: focus the menu title
          e.preventDefault();
          e.stopPropagation();
          onLeft();
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          // access key: activates the item (stopped here so an instrument mode never sounds it)
          const k = items.findIndex((it) => it.accessKey && it.accessKey.toLowerCase() === e.key.toLowerCase() && !it.disabled && !it.separator);
          if (k >= 0) {
            e.preventDefault();
            e.stopPropagation();
            listRef.current?.querySelector<HTMLButtonElement>(`[data-item="${k}"]`)?.click();
          }
        }
      }}
    >
      {items.map((it, k) =>
        it.separator ? (
          <hr key={k} />
        ) : it.items ? (
          <div key={k} className="menu-sub" onPointerEnter={() => hover(it.disabled ? null : k)} onPointerLeave={() => hover(null)}>
            <button
              ref={(el) => {
                subButtons.current[k] = el;
              }}
              role="menuitem"
              className="menu-item has-sub"
              data-item={k}
              aria-haspopup="menu"
              aria-expanded={openSub?.k === k}
              disabled={it.disabled}
              title={it.disabled && it.reason ? `${it.label}: ${it.reason}` : undefined}
              onClick={() => {
                if (it.disabled) return;
                setSubKbd(false);
                setOpenSub(openSub?.k === k ? null : k);
              }}
              onKeyDown={(e) => {
                if (it.disabled) return;
                if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  setSubKbd(true);
                  setOpenSub(k);
                }
              }}
            >
              <span className="check">{it.checked ? '✓' : ''}</span>
              <span className="label">{it.label}</span>
              <span className="shortcut" aria-hidden="true">▸</span>
            </button>
            {openSub?.k === k && (
              <MenuList
                items={it.items}
                onClose={onClose}
                sub
                style={openSub.style}
                autoFocusFirst={subKbd}
                onLeft={() => {
                  const parentItem = (document.activeElement as HTMLElement | null)?.closest('.menu-sub')?.querySelector<HTMLButtonElement>(':scope > button');
                  setOpenSub(null);
                  parentItem?.focus();
                }}
              />
            )}
          </div>
        ) : (
          <button
            key={k}
            role="menuitem"
            className="menu-item"
            data-item={k}
            disabled={it.disabled}
            title={it.disabled && it.reason ? `${it.label}: ${it.reason}` : undefined}
            aria-description={it.disabled ? it.reason : undefined}
            onPointerEnter={() => hover(null)}
            onClick={() => {
              onClose();
              it.action?.();
            }}
          >
            <span className="check">{it.checked ? '✓' : ''}</span>
            <span className="label">{it.label}</span>
            <span className="shortcut">{it.shortcut ?? (it.accessKey ? it.accessKey.toUpperCase() : '')}</span>
          </button>
        ),
      )}
    </div>
  );
}
