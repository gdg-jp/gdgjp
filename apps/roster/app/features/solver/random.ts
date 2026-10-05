/**
 * The solver's ONLY source of randomness (docs/roster/index.md §5.4,
 * docs/roster/06-solver.md Design §3). `Math.random()` must never appear
 * anywhere under `app/features/solver/` — the entire "same input + same seed
 * => same result" contract that Stage 07's re-generate button and Stage 08's
 * history comparison both depend on rests on every random draw in this
 * feature going through this one generator.
 *
 * Copied verbatim from the spec. Do not "clean up" the bitwise operations —
 * they are exactly what makes this a known-good, well-distributed PRNG;
 * changing them changes the numbers this solver produces for a given seed.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
