import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type Browser, type BrowserContext, chromium } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, execute, sameViolation } from "./engine";
import { DESTRUCTIVE_CONTROLS, type ExploreWorld, exploreActions } from "./explore";
import { PageMonitor, Ui } from "./monitor";

type World = ExploreWorld & { readonly context: BrowserContext };

let browser: Browser | null = null;
let server: Server;
let start = "";

beforeAll(async () => {
  browser = await chromium.launch().catch((error: Error) => {
    if (process.env.UI_PROPERTIES_REQUIRE_BROWSER) throw error;
    return null;
  });
  server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end("<main><p>Toolbar</p><button><svg width='16' height='16'></svg></button></main>");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  start = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  await browser?.close();
  await new Promise((done) => server.close(done));
});

const harness = (): Harness<World> => ({
  setup: async () => {
    const context = await (browser as Browser).newContext();
    const monitor = new PageMonitor({ origins: [new URL(start).origin] });
    monitor.watchContext(context);
    const page = await context.newPage();
    await page.goto(start);
    return {
      ui: new Ui(monitor),
      monitor,
      page,
      context,
      start,
      origins: [new URL(start).origin],
      avoid: DESTRUCTIVE_CONTROLS,
    };
  },
  teardown: async (world) => {
    world.monitor.detach();
    await world.context.close();
  },
  observe: (world) => world.monitor.observe(),
  step: (_title, body) => body(),
});

describe("exploreActions", () => {
  it("records the step that touched an unnamed control so its replay fails the same way", async (context) => {
    if (!browser) return context.skip();
    const property = { name: "explore", actions: exploreActions<World>(), invariants: [] };
    const outcome = await execute(property, harness(), { kind: "generate", seed: 1, steps: 20 });
    if (outcome.ok) throw new Error("expected the unnamed button to be reported");
    expect(outcome.violation).toMatchObject({
      kind: "monitor",
      name: "accessible name on every touched control",
    });
    expect(outcome.executed.at(-1)).toMatchObject({
      action: "use a control",
      input: { role: "button", name: "" },
    });
    const replay = await execute(property, harness(), {
      kind: "replay",
      steps: outcome.executed.slice(-1),
    });
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(sameViolation(replay.violation, outcome.violation)).toBe(true);
  }, 60_000);
});
