import { describe, expect, it } from "vitest";
import { align, segmentsFromLines, silencesFromPcm, splitPhrases } from "./align";

function tone(sampleRate: number, pattern: [sound: boolean, sec: number][]): Float32Array {
  const total = pattern.reduce((n, [, sec]) => n + Math.round(sec * sampleRate), 0);
  const out = new Float32Array(total);
  let i = 0;
  for (const [sound, sec] of pattern) {
    const n = Math.round(sec * sampleRate);
    for (let k = 0; k < n; k++) out[i + k] = sound ? 0.5 * Math.sin(k / 3) : 0;
    i += n;
  }
  return out;
}

describe("silencesFromPcm", () => {
  it("finds lead, interior and trailing pauses longer than the minimum", () => {
    const pcm = tone(8000, [
      [false, 0.3],
      [true, 1],
      [false, 0.5],
      [true, 1],
      [false, 0.05],
      [true, 0.5],
      [false, 0.4],
    ]);
    const silences = silencesFromPcm(pcm, 8000);
    expect(silences).toHaveLength(3);
    expect(silences[0].start).toBeCloseTo(0, 1);
    expect(silences[0].end).toBeCloseTo(0.3, 1);
    expect(silences[1].start).toBeCloseTo(1.3, 1);
    expect(silences[1].end).toBeCloseTo(1.8, 1);
    expect(silences[2].end).toBeCloseTo(3.7, 1);
  });
});

describe("align", () => {
  it("puts phrase boundaries on the pauses", () => {
    const silences = [
      { start: 0, end: 0.3 },
      { start: 1.3, end: 1.8 },
      { start: 2.8, end: 3.2 },
    ];
    const { segments } = align(["こんにちは、", "皆さん。"], silences, 3.2);
    expect(segments).toEqual([
      { s: 300, e: 1300, t: "こんにちは、" },
      { s: 1800, e: 2800, t: "皆さん。" },
    ]);
  });

  it("returns nothing for no phrases", () => {
    expect(align([], [], 3).segments).toEqual([]);
  });
});

describe("segmentsFromLines", () => {
  it("drops blank lines and spans the speech without pauses", () => {
    const segments = segmentsFromLines(["  あいう ", "", "えお"], [], 5000);
    expect(segments.map((s) => s.t)).toEqual(["あいう", "えお"]);
    expect(segments[0].s).toBe(0);
    expect(segments[0].e).toBe(3000);
    expect(segments[1].e).toBe(5000);
  });
});

describe("splitPhrases", () => {
  it("splits at Japanese punctuation and keeps closing marks", () => {
    expect(splitPhrases("はい、どうぞ。「ありがとう」！")).toEqual([
      "はい、",
      "どうぞ。",
      "「ありがとう」！",
    ]);
  });
});
