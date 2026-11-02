// Exact rational numbers for display-unit conversion (ADR-002: never round silently).

export interface Rational {
  num: number;
  den: number; // > 0
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function rational(num: number, den = 1): Rational {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den === 0) throw new RangeError(`invalid rational ${num}/${den}`);
  if (den < 0) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

export function isInteger(r: Rational): boolean {
  return r.den === 1;
}

/** Decimal string when the value terminates within `maxDecimals`, otherwise "n/d". */
export function formatRational(r: Rational, maxDecimals = 3): string {
  if (r.den === 1) return String(r.num);
  let d = r.den;
  let twos = 0;
  let fives = 0;
  while (d % 2 === 0) {
    d /= 2;
    twos++;
  }
  while (d % 5 === 0) {
    d /= 5;
    fives++;
  }
  const digits = Math.max(twos, fives);
  if (d === 1 && digits <= maxDecimals) {
    const scale = 10 ** digits;
    const scaled = (r.num * scale) / r.den; // exact integer
    const sign = scaled < 0 ? '-' : '';
    const abs = Math.abs(scaled);
    const intPart = Math.floor(abs / scale);
    const frac = String(abs % scale).padStart(digits, '0');
    return `${sign}${intPart}.${frac}`;
  }
  return `${r.num}/${r.den}`;
}

/** Parses "12", "-3", "12.5", "25/2". Returns null for anything else. */
export function parseRational(text: string): Rational | null {
  const s = text.trim();
  let m = /^(-?\d+)$/.exec(s);
  if (m) return rational(Number(m[1]));
  m = /^(-?)(\d+)\.(\d{1,9})$/.exec(s);
  if (m) {
    const scale = 10 ** m[3].length;
    const v = Number(m[2]) * scale + Number(m[3]);
    return rational(m[1] === '-' ? -v : v, scale);
  }
  m = /^(-?\d+)\/(\d+)$/.exec(s);
  if (m && Number(m[2]) !== 0) return rational(Number(m[1]), Number(m[2]));
  return null;
}
