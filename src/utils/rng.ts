/** String hashing + Mulberry32: portable, stable and independent from Math.random. */
export function createRng(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Daily challenges deliberately change at UTC midnight for every player. */
export function dailySeed(date = new Date()): string {
  return `tower:daily:${date.toISOString().slice(0, 10)}:v1`;
}

export function randomSeed(): string {
  const values = new Uint32Array(2);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return `tower:${values[0].toString(36)}-${values[1].toString(36)}`;
  }
  return `tower:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}
