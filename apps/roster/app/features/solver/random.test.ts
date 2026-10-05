import { describe, expect, it } from "vitest";
import { mulberry32 } from "./random";

describe("mulberry32", () => {
  it("is deterministic: the same seed produces the same sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces a different sequence for a different seed", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("returns values in [0, 1)", () => {
    const rng = mulberry32(123456789);
    for (let i = 0; i < 1000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("does not repeat its own generator instance's early sequence immediately", () => {
    // Sanity check that this is actually a generator and not a constant —
    // if this ever fails, the determinism tests above would be vacuous.
    const rng = mulberry32(7);
    const first = rng();
    const second = rng();
    expect(first).not.toBe(second);
  });

  it("matches known output for seed 1 (regression pin against the spec's exact bit ops)", () => {
    // Pinned from a direct run of the verbatim index.md §5.4 implementation.
    // If this ever changes, someone "cleaned up" the bitwise ops — revert it.
    const rng = mulberry32(1);
    const first = rng();
    const second = rng();
    expect(first).toBeCloseTo(0.6270739405881613, 12);
    expect(second).toBeCloseTo(0.002735721180215478, 12);
  });
});
