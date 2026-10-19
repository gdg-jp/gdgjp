import { describe, expect, it } from "vitest";
import { Reframer, p95 } from "./reframer";

describe("Reframer", () => {
  it("passes audio through delayed by exactly one hop, never running dry", () => {
    const hop = 480;
    const reframer = new Reframer(hop, (frame) => frame.slice());
    const total = 128 * 60;
    const out = new Float32Array(total);
    for (let q = 0; q < 60; q++) {
      const quantum = Float32Array.from({ length: 128 }, (_, i) => q * 128 + i + 1);
      reframer.push(quantum, out.subarray(q * 128, q * 128 + 128));
    }
    for (let i = 0; i < hop; i++) expect(out[i]).toBe(0);
    for (let i = hop; i < total; i++) expect(out[i]).toBe(i - hop + 1);
  });

  it("hands the model whole hops only", () => {
    const sizes: number[] = [];
    const reframer = new Reframer(480, (frame) => {
      sizes.push(frame.length);
      return frame;
    });
    const out = new Float32Array(128);
    for (let q = 0; q < 15; q++) reframer.push(new Float32Array(128), out);
    expect(sizes).toEqual([480, 480, 480, 480]);
  });
});

describe("p95", () => {
  it("picks the 95th percentile", () => {
    expect(p95(Array.from({ length: 100 }, (_, i) => 100 - i))).toBe(96);
    expect(p95([])).toBe(0);
  });
});
