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
import {
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  expect,
  test,
} from "@playwright/test";

test.describe.configure({ retries: 0 });

type Voter = "p1" | "p2";
type Topic = { tag: string; text: string; votes: Set<Voter> };
type OstWorld = UiPropertyWorld & {
  readonly slug: string;
  readonly organizer: Page;
  readonly voters: Record<Voter, Page>;
  readonly contexts: BrowserContext[];
  readonly topics: Topic[];
  next: number;
  organizerAt: "screen" | "edit";
};

const voters: readonly Voter[] = ["p1", "p2"];
const BASE_URL = `http://localhost:${process.env.CI ? 6185 : 5185}`;
const LIVE = { timeout: 10_000 };

const card = (world: OstWorld, topic: Topic) =>
  world.organizer.getByRole("listitem").filter({ hasText: topic.tag });

async function postResponse(page: Page, slug: string, run: () => Promise<void>) {
  const response = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname.startsWith(`/${slug}`),
  );
  await run();
  const result = await response;
  expect(result.status(), `POST ${result.url()}`).toBeLessThan(400);
}

async function fillKnownUnlabeledTopicField(box: Locator, text: string) {
  await expect(box).toHaveAttribute("placeholder", /Cloudflare Workers/);
  await box.fill(text);
}

async function openScreen(world: OstWorld) {
  await world.organizer.goto(`/${world.slug}/screen`);
  await expect(world.organizer.getByText("ライブ")).toBeVisible(LIVE);
  world.organizerAt = "screen";
}

function createWorld(browser: Browser) {
  return async (monitor: PageMonitor): Promise<OstWorld> => {
    const slug = `ui-prop-${randomUUID().slice(0, 12)}`;
    const contexts: BrowserContext[] = [];
    const open = async () => {
      const context = await browser.newContext({ baseURL: BASE_URL, locale: "ja-JP" });
      contexts.push(context);
      monitor.watchContext(context);
      return context.newPage();
    };
    const organizer = await open();
    const seeded = await organizer.request.get(
      `/dev/seed?slug=${slug}&title=Property%20Event&chapter=1:dev-chapter`,
    );
    expect(seeded.ok(), `seeding ${slug}`).toBe(true);
    await organizer.goto(`/dev/login?as=owner&chapter=1:dev-chapter&return_to=/${slug}/screen`);
    const world: OstWorld = {
      ui: new Ui(monitor),
      monitor,
      slug,
      organizer,
      voters: { p1: await open(), p2: await open() },
      contexts,
      topics: [],
      next: 1,
      organizerAt: "screen",
    };
    await openScreen(world);
    return world;
  };
}

const pickTopic = (random: { int(n: number): number }, world: OstWorld) =>
  random.int(world.topics.length);

const property = (browser: Browser): UiProperty<OstWorld> => ({
  name: "ost board",
  setup: createWorld(browser),
  teardown: async (world) => {
    for (const context of world.contexts) await context.close();
  },
  actions: [
    action<OstWorld, { voter: Voter; text: string }>({
      name: "submit a topic",
      weight: 4,
      input: (random, world) => ({
        voter: random.pick(voters),
        text: random.chance(0.15) ? "   " : `t${world.next}: ${random.text()}`,
      }),
      run: async (world, input) => {
        const page = world.voters[input.voter];
        await page.goto(`/${world.slug}`);
        const box = page.getByRole("textbox");
        await fillKnownUnlabeledTopicField(box, input.text);
        const typed = (await box.inputValue()).replace(/\s+/g, " ").trim();
        await world.ui.click(page.getByRole("button", { name: "送信する" }));
        if (typed.length === 0) {
          await expect(page.getByRole("alert")).toContainText("テーマを入力してください");
          return;
        }
        await expect(page.getByRole("heading", { name: "送信しました 🎉" })).toBeVisible();
        const tag = typed.split(" ")[0] ?? "";
        expect(tag, "generated topics start with a unique tag").toMatch(/^t\d+:$/);
        world.topics.push({ tag, text: typed, votes: new Set() });
        world.next = Math.max(world.next, Number(tag.slice(1, -1)) + 1);
      },
    }),
    action<OstWorld, { voter: Voter; topic: number }>({
      name: "toggle a vote",
      weight: 5,
      enabled: (world) => world.topics.length > 0,
      input: (random, world) => ({ voter: random.pick(voters), topic: pickTopic(random, world) }),
      run: async (world, input) => {
        const page = world.voters[input.voter];
        const topic = world.topics[input.topic];
        if (!topic) return;
        await page.goto(`/${world.slug}`);
        await world.ui.click(page.getByRole("button", { name: "投票する" }));
        const row = page.getByRole("dialog").getByRole("listitem").filter({ hasText: topic.tag });
        const thumb = row.getByRole("button", { name: "👍" });
        await expect(thumb).toHaveAttribute("aria-pressed", String(topic.votes.has(input.voter)));
        await postResponse(page, world.slug, () => world.ui.click(thumb));
        if (topic.votes.has(input.voter)) topic.votes.delete(input.voter);
        else topic.votes.add(input.voter);
        await expect(thumb).toHaveAttribute("aria-pressed", String(topic.votes.has(input.voter)));
        await expect(row.getByText(String(topic.votes.size), { exact: true })).toBeVisible(LIVE);
        await world.ui.click(page.getByRole("button", { name: "閉じる" }));
      },
    }),
    action<OstWorld, { topic: number }>({
      name: "organizer deletes a topic",
      weight: 1,
      enabled: (world) => world.topics.length > 0,
      input: (random, world) => ({ topic: pickTopic(random, world) }),
      run: async (world, input) => {
        const topic = world.topics[input.topic];
        if (!topic) return;
        if (world.organizerAt !== "screen") await openScreen(world);
        await postResponse(world.organizer, world.slug, () =>
          world.ui.click(card(world, topic).getByRole("button", { name: "このテーマを削除" })),
        );
        world.topics.splice(input.topic, 1);
      },
    }),
    action<OstWorld>({
      name: "organizer reloads the screen",
      weight: 1,
      run: openScreen,
    }),
    action<OstWorld>({
      name: "organizer opens the layout editor",
      weight: 1,
      run: async (world) => {
        await world.organizer.goto(`/${world.slug}/edit`);
        world.organizerAt = "edit";
        await expect(
          world.organizer.getByRole("heading", { name: `テーマ（${world.topics.length}）` }),
        ).toBeVisible();
        await openScreen(world);
      },
    }),
    action<OstWorld, { voter: Voter; intent: "clear" | "delete" }>({
      name: "participant tries to moderate",
      weight: 1,
      input: (random) => ({ voter: random.pick(voters), intent: random.pick(["clear", "delete"]) }),
      run: async (world, input) => {
        const page = world.voters[input.voter];
        for (const path of [`/${world.slug}/screen`, `/${world.slug}/edit`]) {
          const response = await page.request.post(path, {
            form: { intent: input.intent === "clear" ? "clear" : "delete", topicId: "x" },
            maxRedirects: 0,
          });
          expect(response.status(), `POST ${path} as a participant`).not.toBe(200);
          const view = await page.request.get(path, { maxRedirects: 0 });
          expect(view.status(), `GET ${path} as a participant`).toBe(302);
          expect(view.headers().location).toContain("/signin");
        }
      },
    }),
  ],
  invariants: [
    invariant("the screen shows every topic once with its vote count", async (world) => {
      const page = world.organizer;
      await expect(page.getByText(`${world.topics.length} テーマ`, { exact: true })).toBeVisible(
        LIVE,
      );
      for (const topic of world.topics) {
        const cell = card(world, topic);
        await expect(cell).toHaveCount(1, LIVE);
        await expect(cell.getByText(`${topic.votes.size} 票`, { exact: true })).toBeVisible(LIVE);
      }
    }),
  ],
});

const plan = runPlan({ seeds: [4127, 80021], steps: 40, minutes: 6 });

for (const seed of plan.seeds) {
  test(`seed ${seed} keeps the OST board consistent across participants and the screen`, async ({
    browser,
  }, testInfo) => {
    await checkUiProperty(testInfo, property(browser), {
      plan,
      seed,
      monitor: { origins: [BASE_URL] },
    });
  });
}
