import { execFileSync } from "node:child_process";
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

const PAY_ORIGIN = `http://localhost:${process.env.CI ? 6182 : 5182}`;
const ACTORS = {
  tokyoLead: { chapter: "11:gdg-tokyo:organizer", chapterId: 11, organizer: true },
  tokyoMember: { chapter: "11:gdg-tokyo:member", chapterId: 11, organizer: false },
  osakaLead: { chapter: "22:gdg-osaka:organizer", chapterId: 22, organizer: true },
} as const;
type ActorName = keyof typeof ACTORS;
const NAMES = Object.keys(ACTORS) as ActorName[];
const TITLES = ["DevFest", "勉強会 🎉", "  Study Jam  ", "<b>meetup</b>", "x".repeat(120)];

type Event = { id: string; title: string; owner: ActorName };
type PayWorld = UiPropertyWorld & {
  readonly pages: Record<ActorName, Page>;
  readonly contexts: BrowserContext[];
  readonly marker: string;
  readonly events: Event[];
  readonly at: Partial<Record<ActorName, string>>;
};

const canProxy = (actor: ActorName, event: Event) =>
  actor === event.owner ||
  (ACTORS[actor].organizer && ACTORS[actor].chapterId === ACTORS[event.owner].chapterId);
const canSeeTotal = (actor: ActorName, event: Event) =>
  actor === event.owner || ACTORS[actor].chapterId === ACTORS[event.owner].chapterId;

test.beforeAll(() => {
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "migrations", "apply", "gdgjp-pay-db", "--local"],
    {
      stdio: "pipe",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
});

function createWorld(browser: Browser) {
  return async (monitor: PageMonitor): Promise<PayWorld> => {
    const contexts: BrowserContext[] = [];
    const pages = {} as Record<ActorName, Page>;
    for (const name of NAMES) {
      const context = await browser.newContext({ locale: "ja-JP", baseURL: PAY_ORIGIN });
      monitor.watchContext(context);
      contexts.push(context);
      pages[name] = await context.newPage();
      await pages[name].goto(`/dev/login?as=${name}&chapter=${ACTORS[name].chapter}&return_to=/`);
    }
    return {
      ui: new Ui(monitor),
      monitor,
      pages,
      contexts,
      marker: `PBT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      events: [],
      at: {},
    };
  };
}

const property = (browser: Browser): UiProperty<PayWorld> => ({
  name: "pay event access",
  setup: createWorld(browser),
  teardown: async (world) => {
    for (const context of world.contexts) await context.close();
  },
  actions: [
    action<PayWorld, { actor: ActorName; title: string }>({
      name: "create an event",
      weight: 2,
      enabled: (world) => world.events.length < 4,
      input: (random) => ({ actor: random.pick(NAMES), title: random.pick(TITLES) }),
      run: async (world, input) => {
        const page = world.pages[input.actor];
        const title = `${world.marker} ${world.events.length + 1} ${input.title}`;
        await page.goto("/events/new");
        await world.ui.fill(page.getByLabel("イベント名"), title);
        await world.ui.click(page.getByRole("button", { name: "作成する" }));
        await page.waitForURL((url) => /^\/events\/(?!new$)[^/]+$/.test(url.pathname));
        const id = new URL(page.url()).pathname.split("/").at(-1) ?? "";
        world.events.push({ id, title: title.trim(), owner: input.actor });
        world.at[input.actor] = id;
      },
    }),
    action<PayWorld, { actor: ActorName; event: number }>({
      name: "open an event from the list",
      weight: 3,
      enabled: (world) => world.events.length > 0,
      input: (random, world) => ({
        actor: random.pick(NAMES),
        event: random.int(world.events.length),
      }),
      run: async (world, input) => {
        const page = world.pages[input.actor];
        const event = world.events[input.event] as Event;
        await page.goto("/");
        await world.ui.click(page.getByRole("link", { name: event.title, exact: true }));
        await page.waitForURL(new RegExp(`/events/${event.id}$`));
        world.at[input.actor] = event.id;
      },
    }),
    action<PayWorld, { actor: ActorName; event: number }>({
      name: "try the proxy form",
      weight: 2,
      enabled: (world) => world.events.length > 0,
      input: (random, world) => ({
        actor: random.pick(NAMES),
        event: random.int(world.events.length),
      }),
      run: async (world, input) => {
        const event = world.events[input.event] as Event;
        const response = await world.pages[input.actor].request.get(
          `/events/${event.id}/claims/proxy`,
        );
        expect(
          response.status(),
          `${input.actor} opening the proxy form of ${event.owner}'s event`,
        ).toBe(canProxy(input.actor, event) ? 200 : 403);
      },
    }),
    action<PayWorld, { actor: ActorName }>({
      name: "reload",
      weight: 1,
      enabled: (world) => Object.keys(world.at).length > 0,
      input: (random, world) => ({
        actor: random.pick(NAMES.filter((name) => world.at[name])),
      }),
      run: async (world, input) => {
        const response = await world.pages[input.actor].reload();
        expect(response?.status()).toBe(200);
      },
    }),
  ],
  invariants: [
    invariant(
      "every member's list shows every event once, with its total only to its chapters",
      async (world) => {
        for (const name of NAMES) {
          if (!world.events.length) break;
          const response = await world.pages[name].request.get("/");
          const html = await response.text();
          for (const event of world.events) {
            const rows = html.split(`/events/${event.id}"`);
            expect(rows.length - 1, `${name} sees ${event.id}`).toBe(1);
            const row = rows[1]?.split("</tr>")[0] ?? "";
            expect(row.includes("非公開"), `${name} sees the total of ${event.owner}'s event`).toBe(
              !canSeeTotal(name, event),
            );
          }
        }
      },
    ),
    invariant(
      "management controls appear exactly for owners and their organizers",
      async (world) => {
        for (const name of NAMES) {
          const id = world.at[name];
          const event = world.events.find((item) => item.id === id);
          if (!event) continue;
          const page = world.pages[name];
          await expect(page.getByRole("heading", { level: 1, name: event.title })).toBeVisible();
          const manage = canProxy(name, event);
          await expect(page.getByRole("link", { name: "代行登録" })).toHaveCount(manage ? 1 : 0);
          await expect(
            page.getByRole("heading", { name: manage ? "すべての申請" : "自分の申請" }),
          ).toBeVisible();
          await expect(page.getByText(/^合計 ¥/)).toHaveCount(canSeeTotal(name, event) ? 1 : 0);
        }
      },
    ),
  ],
});

const plan = runPlan({ seeds: [6021, 90210], steps: 60, minutes: 5 });

for (const seed of plan.seeds) {
  test(`seed ${seed} shows pay management only to owners and their organizers`, async ({
    browser,
  }, testInfo) => {
    await checkUiProperty(testInfo, property(browser), {
      plan,
      seed,
      monitor: {
        origins: [PAY_ORIGIN],
      },
    });
  });
}
