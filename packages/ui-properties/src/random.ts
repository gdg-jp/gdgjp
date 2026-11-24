export type Random = {
  readonly seed: number;
  next(): number;
  int(max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(entries: readonly (readonly [number, T])[]): T;
  text(): string;
};

export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const TEXT_SAMPLES = [
  "a",
  "GDG Japan",
  "テスト入力",
  "日本語の長めのテキストを入力して表示の崩れを確かめる",
  "  surrounding spaces  ",
  " ",
  "<b>markup</b> & \"quotes\" 'apostrophes'",
  "emoji 🎉👩‍💻",
  "שלום עולם",
  "x".repeat(300),
  "line one\nline two",
  "0",
  "-1",
  "https://example.com/path?q=1",
];

export function random(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number) => {
    if (!Number.isInteger(max) || max <= 0) throw new Error("random.int needs a positive bound");
    return Math.floor(next() * max);
  };
  const pick = <T>(items: readonly T[]): T => {
    if (!items.length) throw new Error("random.pick needs at least one item");
    return items[int(items.length)] as T;
  };
  return {
    seed: seed >>> 0,
    next,
    int,
    chance: (probability) => next() < probability,
    pick,
    weighted: <T>(entries: readonly (readonly [number, T])[]): T => {
      const total = entries.reduce((sum, [weight]) => sum + Math.max(0, weight), 0);
      if (total <= 0) throw new Error("random.weighted needs a positive total weight");
      let point = next() * total;
      for (const [weight, value] of entries) {
        point -= Math.max(0, weight);
        if (point < 0) return value;
      }
      return entries[entries.length - 1]?.[1] as T;
    },
    text: () => pick(TEXT_SAMPLES),
  };
}
