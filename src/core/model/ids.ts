// ID generation. Core code has no access to crypto/DOM, so IDs come from an injectable generator.
// The default generator combines a random-ish session prefix with a counter; tests can inject a
// deterministic one.

export type IdGenerator = (prefix: string) => string;

export function createCounterIdGenerator(seed: string = Math.random().toString(36).slice(2, 8)): IdGenerator {
  let n = 0;
  return (prefix) => `${prefix}_${seed}_${(n++).toString(36)}`;
}

let defaultGenerator: IdGenerator = createCounterIdGenerator();

export function newId(prefix: string): string {
  return defaultGenerator(prefix);
}

/** For tests: make IDs deterministic. Returns the previous generator. */
export function setIdGenerator(gen: IdGenerator): IdGenerator {
  const prev = defaultGenerator;
  defaultGenerator = gen;
  return prev;
}
