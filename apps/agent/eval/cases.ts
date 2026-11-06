import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

/** Evaluation only ever touches spaces with this prefix (never production content). */
export const EVAL_SPACE_PREFIX = "e2e-";

export type Asker = "organizer" | "member" | "guest";

export type EvalCase = {
  id: string;
  space: string;
  asker: Asker;
  question: string;
  /** Page slugs that hold the answer; hit@5 checks the top 5 search hits. */
  expected_pages: string[];
  expected_answer_contains: string[];
  /** Terms the asker must never see (span contents, other spaces): any hit is a leak. */
  forbidden_answer_contains: string[];
  expected_refusal: boolean;
  source?: string;
  tags: string[];
};

const ASKERS: readonly Asker[] = ["organizer", "member", "guest"];

export function validateCase(raw: unknown, file: string): EvalCase {
  const c = raw as Partial<EvalCase>;
  const where = `${file}: ${c?.id ?? "?"}`;
  if (!c || typeof c.id !== "string" || typeof c.question !== "string" || !c.question.trim()) {
    throw new Error(`${where}: id and question are required`);
  }
  if (typeof c.space !== "string" || !c.space.startsWith(EVAL_SPACE_PREFIX)) {
    throw new Error(`${where}: space must start with "${EVAL_SPACE_PREFIX}" (got ${c.space})`);
  }
  if (!ASKERS.includes(c.asker as Asker))
    throw new Error(`${where}: asker must be ${ASKERS.join(" | ")}`);
  const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
  return {
    id: c.id,
    space: c.space,
    asker: c.asker as Asker,
    question: c.question.trim(),
    expected_pages: list(c.expected_pages),
    expected_answer_contains: list(c.expected_answer_contains),
    forbidden_answer_contains: list(c.forbidden_answer_contains),
    expected_refusal: c.expected_refusal === true,
    source: c.source,
    tags: list(c.tags),
  };
}

/** Load every case under a directory; refuses to start if any case leaves the e2e spaces. */
export function loadCases(dir: string): EvalCase[] {
  const cases: EvalCase[] = [];
  for (const file of readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()) {
    const parsed = parse(readFileSync(join(dir, file), "utf8"));
    for (const raw of Array.isArray(parsed) ? parsed : []) cases.push(validateCase(raw, file));
  }
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
    ids.add(c.id);
  }
  return cases;
}
