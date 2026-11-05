/** User-facing text for a thrown value. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Inputs that take no typing: a focused checkbox (LOOP, SNAP...) must not switch off the PC keyboard (ADR-083). */
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'color', 'button', 'submit', 'reset', 'file', 'image']);

/** Text inputs keep their keys: shortcuts and musical keys must not fire while typing. */
export function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type);
  return el.isContentEditable || ['TEXTAREA', 'SELECT'].includes(el.tagName);
}
