export type Silence = { start: number; end: number };
export type TimedSegment = { s: number; e: number; t: string };

const NOTATION_FIXES: [string, string][] = [
  ["公式ハッシュタグはデブフェスト関西", "公式ハッシュタグは#DevFestKansai"],
  ["デブフェスト関西をつけて", "#DevFestKansaiをつけて"],
  ["デブフェスト関西", "DevFest Kansai"],
  ["デブフェスト2026", "DevFest2026"],
  ["グレーター関西", "Greater Kwansai"],
  ["リオン・ジョーンズ", "Llion Jones"],
  ["リオン様", "Llion様"],
  ["ハローワールド1018", "helloworld1018"],
  ["シェリー様", "Sherry様"],
];

export function fixNotation(text: string): string {
  return NOTATION_FIXES.reduce((t, [from, to]) => t.replaceAll(from, to), text);
}

export function splitPhrases(text: string): string[] {
  const phrases = text.match(/[^、。！？!?]+[、。！？!?」』）)]*|[、。！？!?]+/g) ?? [];
  const out: string[] = [];
  for (const p of phrases) {
    if (out.length > 0 && /^[、。！？!?」』）)]+$/.test(p)) out[out.length - 1] += p;
    else out.push(p);
  }
  return out.map((p) => p.trim()).filter(Boolean);
}

export function silencesFromPcm(
  samples: Float32Array,
  sampleRate: number,
  { noiseDb = -40, minSec = 0.12 }: { noiseDb?: number; minSec?: number } = {},
): Silence[] {
  const threshold = 10 ** (noiseDb / 20);
  const win = Math.max(1, Math.round(sampleRate * 0.01));
  const silences: Silence[] = [];
  let start: number | null = null;
  for (let i = 0; i < samples.length; i += win) {
    let peak = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > peak) peak = v;
    }
    const t = i / sampleRate;
    if (peak < threshold) {
      if (start === null) start = t;
    } else if (start !== null) {
      if (t - start >= minSec) silences.push({ start, end: t });
      start = null;
    }
  }
  const duration = samples.length / sampleRate;
  if (start !== null && duration - start >= minSec) silences.push({ start, end: duration });
  return silences;
}

export type AlignStats = { cps: number; matched: number; unusedPauses: number };

export function align(
  phrases: string[],
  silences: Silence[],
  duration: number,
): { segments: TimedSegment[]; stats: AlignStats } {
  if (phrases.length === 0) {
    return { segments: [], stats: { cps: 0, matched: 1, unusedPauses: 0 } };
  }
  const lead = silences.find((s) => s.start <= 0.01);
  const trail = silences.find((s) => s.end >= duration - 0.01 && s !== lead);
  const speechStart = lead ? lead.end : 0;
  const speechEnd = Math.max(speechStart, trail ? trail.start : duration);
  const interior = silences.filter(
    (s) => s !== lead && s !== trail && s.start > speechStart && s.end < speechEnd,
  );

  const speechRegions: [number, number][] = [];
  let cursor = speechStart;
  for (const s of interior) {
    speechRegions.push([cursor, s.start]);
    cursor = s.end;
  }
  speechRegions.push([cursor, speechEnd]);
  const totalSpeech = speechRegions.reduce((n, [a, b]) => n + (b - a), 0);
  const speechToAbs = (t: number) => {
    let left = t;
    for (const [a, b] of speechRegions) {
      if (left <= b - a) return a + left;
      left -= b - a;
    }
    return speechEnd;
  };

  const lengths = phrases.map((p) => [...p].length);
  const totalChars = Math.max(
    1,
    lengths.reduce((a, b) => a + b, 0),
  );
  const K = phrases.length - 1;
  const M = interior.length;
  const expected: number[] = [];
  let acc = 0;
  for (let i = 0; i < K; i++) {
    acc += lengths[i];
    expected.push(speechToAbs((acc / totalChars) * totalSpeech));
  }

  const MISS_BOUNDARY = 0.9;
  const skipSilence = (s: Silence) => Math.max(0.05, (s.end - s.start) * 2.5);
  const INF = Number.POSITIVE_INFINITY;
  const dp = Array.from({ length: K + 1 }, () => new Float64Array(M + 1).fill(INF));
  const from = Array.from({ length: K + 1 }, () => new Int8Array(M + 1));
  dp[0][0] = 0;
  for (let i = 0; i <= K; i++) {
    for (let j = 0; j <= M; j++) {
      if (i === 0 && j === 0) continue;
      let best = INF;
      let dir = 0;
      if (i > 0 && j > 0) {
        const mid = (interior[j - 1].start + interior[j - 1].end) / 2;
        const c = dp[i - 1][j - 1] + Math.abs(expected[i - 1] - mid);
        if (c < best) [best, dir] = [c, 1];
      }
      if (j > 0) {
        const c = dp[i][j - 1] + skipSilence(interior[j - 1]);
        if (c < best) [best, dir] = [c, 2];
      }
      if (i > 0) {
        const c = dp[i - 1][j] + MISS_BOUNDARY;
        if (c < best) [best, dir] = [c, 3];
      }
      dp[i][j] = best;
      from[i][j] = dir;
    }
  }
  const matched: (Silence | null)[] = new Array(K).fill(null);
  for (let i = K, j = M; i > 0 || j > 0; ) {
    const dir = from[i][j];
    if (dir === 1) {
      matched[i - 1] = interior[j - 1];
      i--;
      j--;
    } else if (dir === 2) j--;
    else i--;
  }

  const bounds: ([number, number] | null)[] = matched.map((s) => (s ? [s.start, s.end] : null));
  const charsThrough = (k: number) => lengths.slice(0, k + 1).reduce((x, y) => x + y, 0);
  const anchors = [
    { idx: -1, t: speechStart, chars: 0 },
    ...bounds.flatMap((b, k) =>
      b ? [{ idx: k, t: (b[0] + b[1]) / 2, chars: charsThrough(k) }] : [],
    ),
    { idx: K, t: speechEnd, chars: totalChars },
  ];
  for (let k = 0; k < K; k++) {
    if (bounds[k]) continue;
    const chars = charsThrough(k);
    const prev = [...anchors].reverse().find((a) => a.idx < k) ?? anchors[0];
    const next = anchors.find((a) => a.idx > k) ?? anchors[anchors.length - 1];
    const span = Math.max(1, next.chars - prev.chars);
    const t = prev.t + ((chars - prev.chars) / span) * (next.t - prev.t);
    bounds[k] = [t, t];
  }

  const segments = phrases.map((text, k) => ({
    s: Math.round((k === 0 ? speechStart : (bounds[k - 1] as [number, number])[1]) * 1000),
    e: Math.round((k === K ? speechEnd : (bounds[k] as [number, number])[0]) * 1000),
    t: text,
  }));
  const matchedCount = matched.filter(Boolean).length;
  return {
    segments,
    stats: {
      cps: totalChars / Math.max(totalSpeech, 0.001),
      matched: K === 0 ? 1 : matchedCount / K,
      unusedPauses: interior.filter((s) => s.end - s.start > 0.35 && !matched.includes(s)).length,
    },
  };
}

export function segmentsFromLines(
  lines: string[],
  silences: Silence[],
  durationMs: number,
): TimedSegment[] {
  const phrases = lines.map((l) => l.trim()).filter(Boolean);
  return align(phrases, silences, durationMs / 1000).segments;
}
