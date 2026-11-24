import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { type TestInfo, test } from "@playwright/test";
import {
  type Harness,
  type Outcome,
  type PropertyDefinition,
  type Step,
  type Violation,
  decodeReplay,
  describeStep,
  encodeReplay,
  execute,
  shrink,
  signature,
} from "./engine";
import { type MonitorOptions, PageMonitor, type Ui } from "./monitor";
import { hashSeed } from "./random";

export type Profile = "pr" | "long";

export type RunPlan = {
  readonly profile: Profile;
  readonly seeds: readonly number[];
  readonly steps: number;
  readonly shrinkReplays: number;
  readonly minutes: number;
  readonly replay: readonly Step[] | null;
};

type Environment = Readonly<Record<string, string | undefined>>;

function positiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function runPlan(
  defaults: {
    readonly seeds: readonly number[];
    readonly steps: number;
    readonly minutes?: number;
  },
  env: Environment = process.env,
  today = new Date(),
): RunPlan {
  const profile = (env.UI_PROPERTY_PROFILE ?? "pr") as Profile;
  if (profile !== "pr" && profile !== "long")
    throw new Error("UI_PROPERTY_PROFILE must be pr or long");
  const long = profile === "long";
  const explicit = env.UI_PROPERTY_SEEDS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const seed = Number(value);
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
        throw new Error(`UI_PROPERTY_SEEDS has an invalid seed: ${value}`);
      return seed;
    });
  const day = today.toISOString().slice(0, 10);
  const extra = long
    ? Array.from(
        { length: positiveInteger(env.UI_PROPERTY_EXTRA_SEEDS, "UI_PROPERTY_EXTRA_SEEDS") ?? 4 },
        (_, index) => hashSeed(`${day}:${index}`),
      )
    : [];
  const replayValue = env.UI_PROPERTY_REPLAY?.trim();
  const replay = replayValue
    ? decodeReplay(replayValue.startsWith("/") ? readFileSync(replayValue, "utf8") : replayValue)
    : null;
  const steps =
    positiveInteger(env.UI_PROPERTY_STEPS, "UI_PROPERTY_STEPS") ??
    (long ? defaults.steps * 5 : defaults.steps);
  return {
    profile,
    seeds: explicit?.length ? explicit : [...defaults.seeds, ...extra],
    steps,
    shrinkReplays:
      positiveInteger(env.UI_PROPERTY_SHRINK_REPLAYS, "UI_PROPERTY_SHRINK_REPLAYS") ??
      (long ? 40 : 10),
    minutes:
      positiveInteger(env.UI_PROPERTY_MINUTES, "UI_PROPERTY_MINUTES") ??
      (long ? (defaults.minutes ?? 6) * 5 : (defaults.minutes ?? 6)),
    replay,
  };
}

export type UiPropertyWorld = { readonly ui: Ui; readonly monitor: PageMonitor };

export type UiProperty<W extends UiPropertyWorld> = PropertyDefinition<W> & {
  readonly setup: (monitor: PageMonitor) => Promise<W>;
  readonly teardown?: (world: W) => Promise<void>;
};

export type FailureRecord = {
  readonly kind: "ui-property-failure";
  readonly property: string;
  readonly title: string;
  readonly workspace: string;
  readonly spec: string;
  readonly seed: number;
  readonly replayed: boolean;
  readonly profile: Profile;
  readonly signature: string;
  readonly violation: Violation;
  readonly steps: readonly Step[];
  readonly minimal: readonly Step[];
  readonly shrinkReplays: number;
  readonly replay: string;
  readonly commands: { readonly seed: string; readonly minimal: string };
  readonly target: string | null;
};

function workspaceName(): string {
  try {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      name?: string;
    };
    return manifest.name ?? "";
  } catch {
    return "";
  }
}

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function grepFor(title: string): string {
  return ` ${title.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

export function replayCommands(input: {
  workspace: string;
  spec: string;
  title: string;
  seed: number;
  steps: number;
  profile: Profile;
  replay: string;
  target?: string | null;
}): { seed: string; minimal: string } {
  const filter = `-- ${shellQuote(input.spec)} -g ${shellQuote(grepFor(input.title))}`;
  const runner = input.target
    ? `UI_FUZZ_TARGETS=${shellQuote(input.target)} pnpm --filter ${input.workspace} exec playwright test --config fuzz/playwright.config.ts -g ${shellQuote(grepFor(input.title))}`
    : `pnpm test:e2e --workspace ${input.workspace} ${filter}`;
  return {
    seed: `UI_PROPERTY_PROFILE=${input.profile} UI_PROPERTY_SEEDS=${input.seed} UI_PROPERTY_STEPS=${input.steps} ${runner}`,
    minimal: `UI_PROPERTY_SEEDS=${input.seed} UI_PROPERTY_REPLAY=${input.replay} ${runner}`,
  };
}

export function formatFailure(record: FailureRecord): string {
  const lines = [
    `UI property "${record.property}" failed with seed ${record.seed}${record.replayed ? " on a replay" : ""} after ${record.steps.length} steps (${record.profile} profile)`,
    `violated: ${record.violation.kind} "${record.violation.name}"`,
    `  ${record.violation.message.split("\n").slice(0, 6).join("\n  ")}`,
    `minimal sequence: ${record.minimal.length} steps after ${record.shrinkReplays} shrink replays`,
    ...record.minimal.map((step, index) => `  ${index + 1}. ${describeStep(step)}`),
    `signature: ${record.signature}`,
  ];
  if (!record.replayed) lines.push(`replay the seed: ${record.commands.seed}`);
  lines.push(`replay the minimal sequence: ${record.commands.minimal}`);
  return lines.join("\n");
}

export async function checkUiProperty<W extends UiPropertyWorld>(
  testInfo: TestInfo,
  property: UiProperty<W>,
  options: {
    readonly plan: RunPlan;
    readonly seed: number;
    readonly monitor?: MonitorOptions;
    readonly target?: string | null;
  },
): Promise<void> {
  const { plan } = options;
  const generationMs = plan.minutes * 60_000;
  const shrinkMs = Math.max(120_000, Math.round(generationMs / 2));
  testInfo.setTimeout(generationMs + shrinkMs + 120_000);
  const started = Date.now();
  let lastMonitor: PageMonitor | null = null;
  const harness: Harness<W> = {
    setup: async () => {
      lastMonitor?.detach();
      lastMonitor = new PageMonitor(options.monitor);
      return property.setup(lastMonitor);
    },
    teardown: async (world) => {
      try {
        await property.teardown?.(world);
      } finally {
        world.monitor.detach();
      }
    },
    observe: (world) => world.monitor.observe(),
    step: (title, body) => test.step(title, body),
  };
  const first: Outcome = await execute(
    property,
    harness,
    plan.replay
      ? { kind: "replay", steps: plan.replay }
      : {
          kind: "generate",
          seed: options.seed,
          steps: plan.steps,
          deadline: started + generationMs,
        },
  );
  const touched = Object.fromEntries((lastMonitor as PageMonitor | null)?.touched ?? []);
  if (first.ok) {
    const counts: Record<string, number> = {};
    for (const step of first.executed) counts[step.action] = (counts[step.action] ?? 0) + 1;
    const summary = {
      kind: "ui-property-run",
      property: property.name,
      seed: plan.replay ? null : options.seed,
      profile: plan.profile,
      requested: plan.replay ? plan.replay.length : plan.steps,
      executed: first.executed.length,
      truncatedByTime: first.truncated,
      actions: counts,
      touchedControls: touched,
    };
    console.log(
      `ui-property ok "${property.name}" seed=${summary.seed ?? "replay"} steps=${summary.executed}/${summary.requested}${first.truncated ? " (time budget reached)" : ""}`,
    );
    await testInfo.attach("ui-property-run.json", {
      body: JSON.stringify(summary, null, 2),
      contentType: "application/json",
    });
    return;
  }
  const shrunk = await shrink(
    { steps: first.executed, violation: first.violation },
    (steps) => execute(property, harness, { kind: "replay", steps }),
    { replays: plan.shrinkReplays, deadline: Date.now() + shrinkMs },
  );
  const workspace = workspaceName();
  const spec = relative(process.cwd(), testInfo.file);
  const replay = encodeReplay(shrunk.steps);
  const record: FailureRecord = {
    kind: "ui-property-failure",
    property: property.name,
    title: testInfo.title,
    workspace,
    spec,
    seed: options.seed,
    replayed: plan.replay !== null,
    profile: plan.profile,
    signature: signature(property.name, first.violation),
    violation: first.violation,
    steps: first.executed,
    minimal: shrunk.steps,
    shrinkReplays: shrunk.replays,
    replay,
    commands: replayCommands({
      workspace,
      spec,
      title: testInfo.title,
      seed: options.seed,
      steps: first.executed.length,
      profile: plan.profile,
      replay,
      target: options.target,
    }),
    target: options.target ?? null,
  };
  const body = JSON.stringify(record, null, 2);
  const output = testInfo.outputPath("ui-property-failure.json");
  writeFileSync(output, body);
  const collected = process.env.UI_PROPERTY_FAILURES_DIR;
  if (collected) {
    mkdirSync(collected, { recursive: true });
    writeFileSync(join(collected, `${record.signature}-${testInfo.testId}.json`), body);
  }
  await testInfo.attach("ui-property-failure.json", { body, contentType: "application/json" });
  const report = formatFailure(record);
  console.error(report);
  throw new Error(report);
}
