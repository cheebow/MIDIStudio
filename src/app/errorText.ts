/** User-facing text for a thrown value. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Text inputs keep their keys: shortcuts and musical keys must not fire while typing. */
export function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}
