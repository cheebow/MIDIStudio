// Min / max over a mapped list without spreading the values as arguments: `Math.max(...arr)`
// throws RangeError past roughly 120k arguments, and a track may hold far more events.

export function maxOf<T>(items: Iterable<T>, value: (item: T) => number, init = -Infinity): number {
  let m = init;
  for (const it of items) {
    const v = value(it);
    if (v > m) m = v;
  }
  return m;
}

export function minOf<T>(items: Iterable<T>, value: (item: T) => number, init = Infinity): number {
  let m = init;
  for (const it of items) {
    const v = value(it);
    if (v < m) m = v;
  }
  return m;
}
