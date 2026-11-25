import { createHash } from "node:crypto";
import { type Random, random } from "./random";

export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

export type Step = { readonly action: string; readonly input: Json };

export type Action<W> = {
  readonly name: string;
  readonly weight: number;
  readonly enabled: (world: W) => boolean | Promise<boolean>;
  readonly input: (random: Random, world: W) => Json | Promise<Json>;
  readonly run: (world: W, input: Json) => Promise<void>;
};

export type Invariant<W> = {
  readonly name: string;
  readonly check: (world: W) => Promise<void>;
};

export type ViolationKind = "setup" | "action" | "invariant" | "monitor" | "stuck";

export type Violation = {
  readonly kind: ViolationKind;
  readonly name: string;
  readonly message: string;
};

export class PropertyViolation extends Error {
  readonly kind: ViolationKind;
  readonly check: string;
  constructor(kind: ViolationKind, check: string, message: string) {
    super(message);
    this.kind = kind;
    this.check = check;
  }
}

export type PropertyDefinition<W> = {
  readonly name: string;
  readonly actions: readonly Action<W>[];
  readonly invariants: readonly Invariant<W>[];
};

export type Harness<W> = {
  setup(): Promise<W>;
  teardown(world: W): Promise<void>;
  observe(world: W): Promise<void>;
  step<T>(title: string, body: () => Promise<T>): Promise<T>;
};

export type Plan =
  | { readonly kind: "generate"; readonly seed: number; readonly steps: number; deadline?: number }
  | { readonly kind: "replay"; readonly steps: readonly Step[] };

export type Outcome =
  | { readonly ok: true; readonly executed: readonly Step[]; readonly truncated: boolean }
  | { readonly ok: false; readonly executed: readonly Step[]; readonly violation: Violation };

type ActionSpec<W, I extends Json> = {
  name: string;
  weight?: number;
  enabled?: (world: W) => boolean | Promise<boolean>;
  input?: (random: Random, world: W) => I | Promise<I>;
  run: (world: W, input: I) => Promise<void>;
};

export function action<W, I extends Json = null>(spec: ActionSpec<W, I>): Action<W> {
  const input = spec.input;
  return {
    name: spec.name,
    weight: spec.weight ?? 1,
    enabled: spec.enabled ?? (() => true),
    input: input ? (generator, world) => input(generator, world) : () => null,
    run: (world, value) => spec.run(world, value as I),
  };
}

export function invariant<W>(name: string, check: (world: W) => Promise<void>): Invariant<W> {
  return { name, check };
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function violationOf(error: unknown, kind: ViolationKind, name: string): PropertyViolation {
  if (error instanceof PropertyViolation) return error;
  return new PropertyViolation(kind, name, message(error));
}

function plain(error: PropertyViolation): Violation {
  return { kind: error.kind, name: error.check, message: error.message };
}

export function describeStep(step: Step): string {
  return step.input === null ? step.action : `${step.action} ${JSON.stringify(step.input)}`;
}

async function observeAll<W>(
  property: PropertyDefinition<W>,
  harness: Harness<W>,
  world: W,
): Promise<void> {
  try {
    await harness.observe(world);
  } catch (error) {
    throw violationOf(error, "monitor", "monitor");
  }
  for (const check of property.invariants) {
    try {
      await check.check(world);
    } catch (error) {
      throw violationOf(error, "invariant", check.name);
    }
  }
}

export async function execute<W>(
  property: PropertyDefinition<W>,
  harness: Harness<W>,
  plan: Plan,
): Promise<Outcome> {
  const executed: Step[] = [];
  const byName = new Map(property.actions.map((item) => [item.name, item]));
  let world: W | undefined;
  try {
    try {
      world = await harness.setup();
    } catch (error) {
      return { ok: false, executed, violation: plain(violationOf(error, "setup", "setup")) };
    }
    const current = world;
    await observeAll(property, harness, current);
    const generator = plan.kind === "generate" ? random(plan.seed) : null;
    const total = plan.kind === "generate" ? plan.steps : plan.steps.length;
    for (let index = 0; index < total; index++) {
      if (plan.kind === "generate" && plan.deadline && Date.now() > plan.deadline)
        return { ok: true, executed, truncated: true };
      let chosen: Action<W>;
      let input: Json;
      if (generator) {
        const enabled: Action<W>[] = [];
        for (const candidate of property.actions)
          if (candidate.weight > 0 && (await candidate.enabled(current))) enabled.push(candidate);
        if (!enabled.length) {
          return {
            ok: false,
            executed,
            violation: {
              kind: "stuck",
              name: "no enabled action",
              message: `No action is enabled after ${executed.length} steps`,
            },
          };
        }
        chosen = generator.weighted(enabled.map((item) => [item.weight, item] as const));
        input = await chosen.input(generator, current);
      } else {
        const step = (plan as { steps: readonly Step[] }).steps[index] as Step;
        const found = byName.get(step.action);
        if (!found) throw new Error(`Replay names an unknown action: ${step.action}`);
        if (!(await found.enabled(current))) continue;
        chosen = found;
        input = step.input;
      }
      const step: Step = { action: chosen.name, input };
      executed.push(step);
      const position = executed.length;
      try {
        await harness.step(`${position}: ${describeStep(step)}`, async () => {
          try {
            await chosen.run(current, input);
          } catch (error) {
            throw violationOf(error, "action", chosen.name);
          }
          await observeAll(property, harness, current);
        });
      } catch (error) {
        throw violationOf(error, "action", chosen.name);
      }
    }
    return { ok: true, executed, truncated: false };
  } catch (error) {
    return { ok: false, executed, violation: plain(violationOf(error, "action", "unknown")) };
  } finally {
    if (world !== undefined) await harness.teardown(world).catch(() => undefined);
  }
}

export function sameViolation(a: Violation, b: Violation): boolean {
  return (
    a.kind === b.kind &&
    a.name === b.name &&
    normalizeMessage(a.message) === normalizeMessage(b.message)
  );
}

export type ShrinkResult = {
  readonly steps: readonly Step[];
  readonly violation: Violation;
  readonly replays: number;
};

export async function shrink(
  failing: { readonly steps: readonly Step[]; readonly violation: Violation },
  replay: (steps: readonly Step[]) => Promise<Outcome>,
  limits: { readonly replays: number; readonly deadline?: number },
): Promise<ShrinkResult> {
  let steps = failing.steps;
  let violation = failing.violation;
  let replays = 0;
  const exhausted = () =>
    replays >= limits.replays || (limits.deadline !== undefined && Date.now() > limits.deadline);
  let chunk = Math.max(1, Math.ceil(steps.length / 2));
  while (steps.length > 0 && !exhausted()) {
    let reduced = false;
    for (let start = 0; start < steps.length && !exhausted(); start += chunk) {
      const candidate = [...steps.slice(0, start), ...steps.slice(start + chunk)];
      if (candidate.length === steps.length) continue;
      replays++;
      const outcome = await replay(candidate);
      if (!outcome.ok && sameViolation(outcome.violation, failing.violation)) {
        steps = outcome.executed;
        violation = outcome.violation;
        reduced = true;
        break;
      }
    }
    if (reduced) chunk = Math.max(1, Math.min(chunk, Math.ceil(steps.length / 2)));
    else if (chunk === 1) break;
    else chunk = Math.max(1, Math.floor(chunk / 2));
  }
  return { steps, violation, replays };
}

export function normalizeMessage(text: string): string {
  return (text.split("\n").find((line) => line.trim()) ?? "")
    .replaceAll(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "")
    .replaceAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replaceAll(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replaceAll(/\d+/g, "#")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function signature(property: string, violation: Violation): string {
  return createHash("sha256")
    .update(
      `${property}\n${violation.kind}:${violation.name}\n${normalizeMessage(violation.message)}`,
    )
    .digest("hex")
    .slice(0, 16);
}

export function encodeReplay(steps: readonly Step[]): string {
  return Buffer.from(JSON.stringify(steps)).toString("base64url");
}

export function decodeReplay(value: string): Step[] {
  const parsed: unknown = JSON.parse(
    value.trimStart().startsWith("[") ? value : Buffer.from(value, "base64url").toString("utf8"),
  );
  if (
    !Array.isArray(parsed) ||
    !parsed.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof item.action === "string" &&
        "input" in item,
    )
  )
    throw new Error("A replay must be a JSON array of { action, input } steps");
  return parsed as Step[];
}
