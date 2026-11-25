import { describe, expect, it } from "vitest";
import {
  type Harness,
  PropertyViolation,
  type Step,
  action,
  decodeReplay,
  encodeReplay,
  execute,
  invariant,
  normalizeMessage,
  sameViolation,
  shrink,
  signature,
} from "./engine";
import { random } from "./random";

type World = { count: number; log: string[]; broken: boolean };

const harness = (broken = false): Harness<World> => ({
  setup: async () => ({ count: 0, log: [], broken }),
  teardown: async () => undefined,
  observe: async () => undefined,
  step: (_title, body) => body(),
});

const counter = {
  name: "counter",
  actions: [
    action<World, number>({
      name: "add",
      weight: 3,
      input: (generator) => generator.int(3),
      run: async (world, amount) => {
        world.count += world.broken && amount === 2 ? 3 : amount;
        world.log.push(`add ${amount}`);
      },
    }),
    action<World>({
      name: "reset",
      enabled: (world) => world.count > 0,
      run: async (world) => {
        world.count = 0;
        world.log.push("reset");
      },
    }),
  ],
  invariants: [
    invariant<World>("count matches the log", async (world) => {
      let expected = 0;
      for (const entry of world.log)
        expected = entry === "reset" ? 0 : expected + Number(entry.split(" ")[1]);
      if (world.count !== expected)
        throw new Error(`count ${world.count} does not match ${expected}`);
    }),
  ],
};

describe("random", () => {
  it("repeats the same sequence for the same seed", () => {
    const a = random(42);
    const b = random(42);
    const draws = Array.from({ length: 20 }, () => [a.next(), b.next()]);
    for (const [left, right] of draws) expect(left).toBe(right);
    expect(random(43).next()).not.toBe(random(42).next());
  });

  it("respects weights and bounds", () => {
    const generator = random(7);
    const counts = { heavy: 0, light: 0 };
    for (let index = 0; index < 2000; index++)
      counts[
        generator.weighted([
          [9, "heavy"],
          [1, "light"],
        ] as const)
      ]++;
    expect(counts.heavy).toBeGreaterThan(counts.light * 5);
    for (let index = 0; index < 100; index++) expect(generator.int(3)).toBeLessThan(3);
  });
});

describe("execute", () => {
  it("generates the same steps for a seed and replays them exactly", async () => {
    const first = await execute(counter, harness(), { kind: "generate", seed: 5, steps: 30 });
    const second = await execute(counter, harness(), { kind: "generate", seed: 5, steps: 30 });
    expect(first.ok).toBe(true);
    expect(second.executed).toEqual(first.executed);
    const replayed = await execute(counter, harness(), { kind: "replay", steps: first.executed });
    expect(replayed.executed).toEqual(first.executed);
  });

  it("only picks enabled actions and skips disabled replay steps", async () => {
    const outcome = await execute(counter, harness(), { kind: "generate", seed: 11, steps: 50 });
    let count = 0;
    for (const step of outcome.executed) {
      if (step.action === "reset") expect(count).toBeGreaterThan(0);
      count = step.action === "reset" ? 0 : count + Number(step.input);
    }
    const replayed = await execute(counter, harness(), {
      kind: "replay",
      steps: [{ action: "reset", input: null }],
    });
    expect(replayed.executed).toEqual([]);
  });

  it("reports the invariant that failed and the steps up to it", async () => {
    const outcome = await execute(counter, harness(true), {
      kind: "generate",
      seed: 3,
      steps: 200,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.violation).toMatchObject({ kind: "invariant", name: "count matches the log" });
    expect(outcome.executed.at(-1)).toEqual({ action: "add", input: 2 });
  });

  it("labels action errors and setup errors", async () => {
    const failing = {
      name: "failing",
      actions: [
        action<World>({
          name: "explode",
          run: async () => {
            throw new Error("boom");
          },
        }),
      ],
      invariants: [],
    };
    const outcome = await execute(failing, harness(), { kind: "generate", seed: 1, steps: 5 });
    expect(outcome).toMatchObject({
      ok: false,
      violation: { kind: "action", name: "explode", message: "boom" },
    });
    const setup = await execute(
      failing,
      {
        ...harness(),
        setup: async () => {
          throw new Error("no fixture");
        },
      },
      { kind: "generate", seed: 1, steps: 5 },
    );
    expect(setup).toMatchObject({ ok: false, violation: { kind: "setup" } });
  });

  it("keeps a monitor's own label", async () => {
    const outcome = await execute(
      counter,
      {
        ...harness(),
        observe: async (world) => {
          if (world.count > 3) throw new PropertyViolation("monitor", "no 5xx responses", "500");
        },
      },
      { kind: "generate", seed: 9, steps: 100 },
    );
    expect(outcome).toMatchObject({
      ok: false,
      violation: { kind: "monitor", name: "no 5xx responses" },
    });
  });

  it("stops with a stuck violation when nothing is enabled", async () => {
    const stuck = {
      name: "stuck",
      actions: [action<World>({ name: "never", enabled: () => false, run: async () => undefined })],
      invariants: [],
    };
    const outcome = await execute(stuck, harness(), { kind: "generate", seed: 1, steps: 3 });
    expect(outcome).toMatchObject({ ok: false, violation: { kind: "stuck" } });
  });
});

describe("shrink", () => {
  it("reduces a failing sequence to the steps that matter", async () => {
    const outcome = await execute(counter, harness(true), {
      kind: "generate",
      seed: 3,
      steps: 200,
    });
    if (outcome.ok) throw new Error("expected a failure");
    const result = await shrink(
      { steps: outcome.executed, violation: outcome.violation },
      (steps) => execute(counter, harness(true), { kind: "replay", steps }),
      { replays: 200 },
    );
    expect(result.steps).toEqual([{ action: "add", input: 2 }]);
    expect(result.violation.name).toBe("count matches the log");
  });

  it("keeps the original failure when a shorter sequence fails the same check elsewhere", async () => {
    type Api = { warm: boolean; searched: boolean };
    const api = {
      name: "api",
      actions: [
        action<Api>({
          name: "warm",
          run: async (world) => {
            world.warm = true;
          },
        }),
        action<Api>({
          name: "search",
          run: async (world) => {
            if (!world.warm)
              throw new PropertyViolation(
                "monitor",
                "no 5xx responses",
                "GET https://pr.stg1.gdgs.jp/search returned 503",
              );
            world.searched = true;
          },
        }),
        action<Api>({
          name: "approve",
          run: async (world) => {
            if (world.searched)
              throw new PropertyViolation(
                "monitor",
                "no 5xx responses",
                "POST https://pr.stg1.gdgs.jp/approval returned 500",
              );
          },
        }),
      ],
      invariants: [],
    };
    const apiHarness: Harness<Api> = {
      setup: async () => ({ warm: false, searched: false }),
      teardown: async () => undefined,
      observe: async () => undefined,
      step: (_title, body) => body(),
    };
    const steps: Step[] = [
      { action: "warm", input: null },
      { action: "search", input: null },
      { action: "approve", input: null },
    ];
    const outcome = await execute(api, apiHarness, { kind: "replay", steps });
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.violation.message).toContain("/approval returned 500");
    const result = await shrink(
      { steps: outcome.executed, violation: outcome.violation },
      (candidate) => execute(api, apiHarness, { kind: "replay", steps: candidate }),
      { replays: 50 },
    );
    expect(result.violation.message).toContain("/approval returned 500");
    expect(result.steps).toEqual(steps);
    expect(
      sameViolation(outcome.violation, {
        ...outcome.violation,
        message: "POST https://pr.stg1.gdgs.jp/approval returned 502",
      }),
    ).toBe(true);
  });

  it("stops at the replay limit", async () => {
    const steps: Step[] = Array.from({ length: 64 }, () => ({ action: "add", input: 1 }));
    let replays = 0;
    const result = await shrink(
      { steps, violation: { kind: "invariant", name: "x", message: "" } },
      async (candidate) => {
        replays++;
        return { ok: true, executed: candidate, truncated: false };
      },
      { replays: 5 },
    );
    expect(replays).toBe(5);
    expect(result.steps).toBe(steps);
  });
});

describe("reporting", () => {
  it("round-trips replays", () => {
    const steps: Step[] = [
      { action: "add", input: 2 },
      { action: "share", input: { page: "a", role: "member" } },
    ];
    expect(decodeReplay(encodeReplay(steps))).toEqual(steps);
    expect(decodeReplay(JSON.stringify(steps))).toEqual(steps);
    expect(() => decodeReplay(Buffer.from("{}").toString("base64url"))).toThrow();
  });

  it("gives the same signature to failures that differ only in ids and numbers", () => {
    const a = {
      kind: "invariant" as const,
      name: "scope",
      message: "page 3f2c9a1e-1111-4222-8333-444455556666 shows 12 grants\nstack",
    };
    const b = { ...a, message: "page 9a9a9a9a-1111-4222-8333-444455556666 shows 7 grants" };
    expect(normalizeMessage(a.message)).toBe("page <id> shows # grants");
    expect(signature("p", a)).toBe(signature("p", b));
    expect(signature("p", a)).not.toBe(signature("q", a));
  });
});
