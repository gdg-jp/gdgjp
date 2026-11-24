import { randomUUID } from "node:crypto";
import {
  type PageMonitor,
  Ui,
  type UiProperty,
  type UiPropertyWorld,
  action,
  checkUiProperty,
  invariant,
  runPlan,
} from "@gdgjp/ui-properties";
import { type Browser, type BrowserContext, type Page, expect, test } from "@playwright/test";

test.describe.configure({ retries: 0 });

type Stage = { id: string; name: string; alive: boolean };
type ScreenWorld = UiPropertyWorld & {
  readonly tag: string;
  readonly operator: Page;
  readonly speaker: Page;
  readonly outsider: BrowserContext;
  readonly contexts: BrowserContext[];
  readonly stages: Stage[];
  next: number;
};

const BASE_URL = `http://localhost:${process.env.CI ? 6188 : 5188}`;
const WORDS = ["Main", "Hall B", "ワークショップ", "Track 2", "サブ会場", "LT"];

const row = (world: ScreenWorld, stage: Stage) =>
  world.operator.locator(".sc-stage-row").filter({ hasText: stage.id });
const alive = (world: ScreenWorld) => world.stages.filter((stage) => stage.alive);

async function home(world: ScreenWorld) {
  if (new URL(world.operator.url()).pathname !== "/") await world.operator.goto("/");
  else await world.operator.reload();
  await expect(
    world.operator.getByRole("button", { name: "ステージを作成" }).first(),
  ).toBeVisible();
}

async function settle(world: ScreenWorld) {
  await expect(world.operator.getByRole("dialog")).toHaveCount(0);
  await expect(world.operator.getByRole("alertdialog")).toHaveCount(0);
  await expect(world.operator.locator("[aria-hidden=true] .sc-stage-list")).toHaveCount(0);
}

async function openMenu(world: ScreenWorld, stage: Stage, item: string) {
  await home(world);
  await world.ui.click(row(world, stage).getByRole("button", { name: "メニュー" }));
  await world.ui.click(world.operator.getByRole("menuitem", { name: item }));
}

function createWorld(browser: Browser) {
  return async (monitor: PageMonitor): Promise<ScreenWorld> => {
    const contexts: BrowserContext[] = [];
    const open = async (watch: boolean) => {
      const context = await browser.newContext({
        baseURL: BASE_URL,
        locale: "ja-JP",
        permissions: ["camera", "microphone"],
      });
      contexts.push(context);
      if (watch) monitor.watchContext(context);
      return context;
    };
    const operator = await (await open(true)).newPage();
    await operator.goto("/dev/login?as=e2e-property-op&return_to=/");
    const speaker = await (await open(true)).newPage();
    const outsider = await open(false);
    return {
      ui: new Ui(monitor),
      monitor,
      tag: randomUUID().slice(0, 8),
      operator,
      speaker,
      outsider,
      contexts,
      stages: [],
      next: 1,
    };
  };
}

const pickStage = (random: { pick<T>(items: readonly T[]): T }, world: ScreenWorld) =>
  world.stages.indexOf(random.pick(alive(world)));

const property = (browser: Browser): UiProperty<ScreenWorld> => ({
  name: "screen stages",
  setup: createWorld(browser),
  teardown: async (world) => {
    for (const stage of alive(world))
      await world.operator.request
        .post("/api/stages", { form: { intent: "delete", stageId: stage.id }, maxRedirects: 0 })
        .catch(() => undefined);
    for (const context of world.contexts) await context.close();
  },
  actions: [
    action<ScreenWorld, { word: string }>({
      name: "create a stage",
      weight: 3,
      enabled: (world) => alive(world).length < 4,
      input: (random) => ({ word: random.pick(WORDS) }),
      run: async (world, input) => {
        const name = `${world.tag} S${world.next} ${input.word}`;
        await home(world);
        await world.ui.click(
          world.operator.getByRole("button", { name: "ステージを作成" }).first(),
        );
        await world.ui.fill(world.operator.getByRole("textbox", { name: "名前" }), name);
        await world.ui.click(world.operator.getByRole("button", { name: "作成" }));
        await world.operator.waitForURL(/\/stages\/[a-z0-9-]+$/);
        const id = new URL(world.operator.url()).pathname.split("/").pop() ?? "";
        world.stages.push({ id, name, alive: true });
        world.next++;
      },
    }),
    action<ScreenWorld, { stage: number; text: string }>({
      name: "rename a stage",
      weight: 3,
      enabled: (world) => alive(world).length > 0,
      input: (random, world) => ({ stage: pickStage(random, world), text: random.text() }),
      run: async (world, input) => {
        const stage = world.stages[input.stage];
        if (!stage) return;
        await openMenu(world, stage, "名前を変更");
        const dialog = world.operator.getByRole("dialog");
        const box = dialog.getByRole("textbox");
        await world.ui.fill(box, `${world.tag} R${world.next++} ${input.text}`);
        const name = (await box.inputValue()).trim().slice(0, 40);
        const saved = world.operator.waitForResponse(
          (r) => r.request().method() === "POST" && r.url().includes("/api/stages"),
        );
        await world.ui.click(dialog.getByRole("button", { name: "保存" }));
        expect((await saved).status()).toBe(200);
        await settle(world);
        stage.name = name;
      },
    }),
    action<ScreenWorld, { stage: number }>({
      name: "delete a stage",
      weight: 1,
      enabled: (world) => alive(world).length > 0,
      input: (random, world) => ({ stage: pickStage(random, world) }),
      run: async (world, input) => {
        const stage = world.stages[input.stage];
        if (!stage) return;
        await openMenu(world, stage, "削除");
        await world.ui.click(
          world.operator.getByRole("alertdialog").getByRole("button", { name: "削除" }),
        );
        await world.operator.waitForURL(/\/$/);
        await settle(world);
        stage.alive = false;
      },
    }),
    action<ScreenWorld, { stage: number }>({
      name: "speaker opens an invite",
      weight: 3,
      enabled: (world) => world.stages.length > 0,
      input: (random, world) => ({ stage: random.int(world.stages.length) }),
      run: async (world, input) => {
        const stage = world.stages[input.stage];
        if (!stage) return;
        if (stage.alive) {
          await world.speaker.goto(`/${stage.id}/`);
          await expect(world.speaker.getByText(stage.name, { exact: true }).first()).toBeVisible();
          await expect(world.speaker.getByRole("button", { name: "参加" })).toBeVisible();
        } else {
          const page = await world.outsider.newPage();
          await page.goto(`/${stage.id}/`);
          await expect(page.getByText("リンクが無効です")).toBeVisible();
          await page.close();
        }
      },
    }),
    action<ScreenWorld, { stage: number; intent: "rename" | "delete" | "rotate-output" }>({
      name: "speaker tries operator actions",
      weight: 2,
      enabled: (world) => world.stages.length > 0,
      input: (random, world) => ({
        stage: random.int(world.stages.length),
        intent: random.pick(["rename", "delete", "rotate-output"]),
      }),
      run: async (world, input) => {
        const stage = world.stages[input.stage];
        if (!stage) return;
        const request = world.speaker.request;
        const post = await request.post("/api/stages", {
          form: { intent: input.intent, stageId: stage.id, name: "hijacked" },
          maxRedirects: 0,
        });
        expect(post.status(), `POST ${input.intent} as a speaker`).toBe(302);
        expect(post.headers().location).toContain("/signin");
        for (const path of [`/stages/${stage.id}`, "/"]) {
          const view = await request.get(path, { maxRedirects: 0 });
          expect(view.status(), `GET ${path} as a speaker`).toBe(302);
        }
      },
    }),
    action<ScreenWorld>({
      name: "operator reloads the list",
      weight: 1,
      run: home,
    }),
  ],
  invariants: [
    invariant("the operator's list matches the stages that exist", async (world) => {
      if (new URL(world.operator.url()).pathname !== "/") return;
      const rows = world.operator.locator(".sc-stage-row").filter({ hasText: world.tag });
      await expect(rows).toHaveCount(alive(world).length);
      for (const stage of alive(world))
        await expect(row(world, stage).locator(".sc-stage-name strong")).toHaveText(stage.name);
    }),
  ],
});

const plan = runPlan({ seeds: [3301, 72057], steps: 30, minutes: 6 });

for (const seed of plan.seeds) {
  test(`seed ${seed} keeps stage names and operator access consistent`, async ({
    browser,
  }, testInfo) => {
    await checkUiProperty(testInfo, property(browser), {
      plan,
      seed,
      monitor: {
        origins: [BASE_URL],
        ignoreResponses: [/\/rtc\/[^/]+\/sessions\//],
        ignoreConsole: [/^Failed to fetch manifest patches TypeError: Failed to fetch/],
      },
    });
  });
}
