import type { CheckResult } from "@skills/pr-playbook/scripts/checks/index.mjs";

export type LeafEdit = {
  field: string;
  before: string | null;
  after: string | null;
  charDistance: number;
};

const escapePointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

/** Scalar leaves (as text) of a JSON value by JSON Pointer. Worker-added keys are left out. */
export function stringLeaves(
  value: unknown,
  skip: ReadonlySet<string> = new Set(),
  path = "",
): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") out.set(path || "/", value);
  else if (typeof value === "number" || typeof value === "boolean")
    out.set(path || "/", String(value));
  else if (Array.isArray(value))
    value.forEach((v, i) => {
      for (const [k, s] of stringLeaves(v, skip, `${path}/${i}`)) out.set(k, s);
    });
  else if (value && typeof value === "object")
    for (const [key, v] of Object.entries(value)) {
      if (!path && skip.has(key)) continue;
      for (const [k, s] of stringLeaves(v, skip, `${path}/${escapePointer(key)}`)) out.set(k, s);
    }
  return out;
}

/** Levenshtein over code points (bounded: long texts are compared by length past 4000 chars). */
export function charDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  if (x.length * y.length > 4_000_000)
    return Math.abs(x.length - y.length) + Math.min(x.length, y.length);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++)
      cur[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return prev[y.length] ?? 0;
}

/** One row per changed string leaf (added, removed or edited). */
export function diffLeaves(
  before: unknown,
  after: unknown,
  skip: ReadonlySet<string> = new Set(["html", "skin", "renderWarnings"]),
): LeafEdit[] {
  const a = stringLeaves(before, skip);
  const b = stringLeaves(after, skip);
  const fields = [...new Set([...a.keys(), ...b.keys()])].sort();
  return fields
    .filter((f) => a.get(f) !== b.get(f))
    .map((field) => {
      const x = a.get(field) ?? null;
      const y = b.get(field) ?? null;
      return { field, before: x, after: y, charDistance: charDistance(x ?? "", y ?? "") };
    });
}

/** Rules whose result changed between the two versions. */
export function ruleHints(before: CheckResult[], after: CheckResult[]): string[] {
  const was = new Map(before.map((r) => [r.ruleId, r.status]));
  return after
    .filter((r) => was.get(r.ruleId) !== r.status)
    .map((r) => r.ruleId)
    .sort();
}

/** Emails and @handles must not reach examples or proposals (feedback.mjs refuses them too). */
export function personalData(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) found.add(m[0]);
  for (const m of text.matchAll(/(^|[^\w@/])(@[A-Za-z0-9_]{2,15})\b/g)) if (m[2]) found.add(m[2]);
  return [...found];
}
