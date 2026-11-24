import { randomUUID } from "node:crypto";
import {
  DESTRUCTIVE_CONTROLS,
  type ExploreWorld,
  type PageMonitor,
  Ui,
  type UiProperty,
  action,
  checkUiProperty,
  exploreActions,
  invariant,
  runPlan,
} from "@gdgjp/ui-properties";
import { type Browser, type BrowserContext, type Page, expect, test } from "@playwright/test";

test.describe.configure({ retries: 0 });

const TINYURL_URL = `http://localhost:${process.env.CI ? 6174 : 5174}`;
const ACCOUNTS_URL = `http://localhost:${process.env.CI ? 6173 : 5173}`;

type ActorName = "alice" | "bob";
type Actor = { name: ActorName; login: string; page: Page; context: BrowserContext };
type Visibility = "private" | "public";
type ModelLink = {
  id: string;
  slug: string;
  owner: ActorName;
  visibility: Visibility;
  deleted: boolean;
};
type World = ExploreWorld & { actors: Record<ActorName, Actor>; links: ModelLink[] };

const actors: readonly ActorName[] = ["alice", "bob"];

function canView(actor: ActorName, link: ModelLink): boolean {
  return !link.deleted && (link.owner === actor || link.visibility === "public");
}

async function linkStatus(actor: Actor, link: ModelLink): Promise<number> {
  const response = await actor.page.request.get(`${TINYURL_URL}/links/${link.id}`, {
    maxRedirects: 0,
    timeout: 15_000,
  });
  return response.status();
}

function createWorld(browser: Browser) {
  return async (monitor: PageMonitor): Promise<World> => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const chapterBase = 9000 + Math.floor(Math.random() * 900) * 2;
    const make = async (name: ActorName, index: number): Promise<Actor> => {
      const context = await browser.newContext({ locale: "en-US" });
      context.setDefaultTimeout(15_000);
      await context.route(
        (url) => !["localhost", "127.0.0.1"].includes(url.hostname),
        (route) => route.fulfill({ status: 204 }),
      );
      monitor.watchContext(context);
      const page = await context.newPage();
      const login = `${name}${suffix}`;
      const chapter = `${chapterBase + index}:property-${name}-${suffix}:member`;
      const response = await page.goto(
        `${TINYURL_URL}/dev/login?as=${login}&chapter=${encodeURIComponent(chapter)}&return_to=/links`,
      );
      if (!response || response.status() >= 400)
        throw new Error(`dev login for ${name} returned ${response?.status()}`);
      return { name, login, page, context };
    };
    const alice = await make("alice", 0);
    const bob = await make("bob", 1);
    return {
      ui: new Ui(monitor),
      monitor,
      actors: { alice, bob },
      links: [],
      page: alice.page,
      start: `${TINYURL_URL}/links`,
      origins: [TINYURL_URL],
      avoid: new RegExp(
        `${DESTRUCTIVE_CONTROLS.source}|sign in|google|save|保存|update|更新|share|共有|add|追加|create|作成|new|visibility`,
        "i",
      ),
    };
  };
}

const property = (browser: Browser): UiProperty<World> => ({
  name: "tinyurl link ownership",
  setup: createWorld(browser),
  teardown: async (world) => {
    for (const actor of Object.values(world.actors)) await actor.context.close();
  },
  actions: [
    action<World, { actor: ActorName; visibility: Visibility }>({
      name: "create link",
      weight: 3,
      enabled: (world) => world.links.length < 6,
      input: (random) => ({
        actor: random.pick(actors),
        visibility: random.pick(["private", "public"] as const),
      }),
      run: async (world, input) => {
        const actor = world.actors[input.actor];
        const slug = `p${randomUUID().replaceAll("-", "").slice(0, 12)}`;
        const response = await actor.page.request.post(`${TINYURL_URL}/api/links`, {
          form: {
            slug,
            destinationUrl: `https://1.1.1.1/${slug}`,
            title: `Property ${slug}`,
            visibility: input.visibility,
            domainId: "1",
          },
          maxRedirects: 0,
        });
        const location = response.headers().location ?? "";
        const id = /\/links\/(link_[0-9A-Z]+)/.exec(location)?.[1];
        expect(
          id,
          `creating a link must redirect to it (status ${response.status()})`,
        ).toBeTruthy();
        world.links.push({
          id: id ?? "",
          slug,
          owner: input.actor,
          visibility: input.visibility,
          deleted: false,
        });
      },
    }),
    action<World, { actor: ActorName; link: number }>({
      name: "open link page",
      weight: 3,
      enabled: (world) => world.links.length > 0,
      input: (random, world) => ({
        actor: random.pick(actors),
        link: random.int(world.links.length),
      }),
      run: async (world, input) => {
        const actor = world.actors[input.actor];
        const link = world.links[input.link] as ModelLink;
        const expected = canView(input.actor, link) ? 200 : link.deleted ? 404 : 403;
        if (expected === 200) {
          const response = await actor.page.goto(`${TINYURL_URL}/links/${link.id}`, {
            timeout: 20_000,
          });
          expect(response?.status(), `${input.actor} opening ${link.slug}`).toBe(200);
        } else {
          expect(await linkStatus(actor, link), `${input.actor} opening ${link.slug}`).toBe(
            expected,
          );
        }
      },
    }),
    action<World, { actor: ActorName; link: number }>({
      name: "delete link",
      weight: 1,
      enabled: (world) => world.links.some((link) => !link.deleted),
      input: (random, world) => ({
        actor: random.pick(actors),
        link: random.int(world.links.length),
      }),
      run: async (world, input) => {
        const actor = world.actors[input.actor];
        const link = world.links[input.link] as ModelLink;
        await actor.page.request.post(`${TINYURL_URL}/links/${link.id}`, {
          form: { intent: "delete" },
          maxRedirects: 0,
          timeout: 15_000,
        });
        if (link.owner === input.actor) link.deleted = true;
      },
    }),
    action<World, { actor: ActorName }>({
      name: "open dashboard",
      weight: 2,
      input: (random) => ({ actor: random.pick(actors) }),
      run: async (world, input) => {
        const response = await world.actors[input.actor].page.goto(`${TINYURL_URL}/links`, {
          timeout: 20_000,
        });
        expect(response?.status()).toBe(200);
      },
    }),
    ...exploreActions<World>().map((item) => ({
      ...item,
      weight: item.name === "use a control" ? 2 : 0.5,
    })),
  ],
  invariants: [
    invariant("each actor reaches exactly the links the model allows", async (world) => {
      for (const link of world.links)
        for (const name of actors) {
          const status = await linkStatus(world.actors[name], link);
          const expected = canView(name, link) ? 200 : link.deleted ? 404 : 403;
          expect(status, `${name} → ${link.slug} (${link.visibility}, owner ${link.owner})`).toBe(
            expected,
          );
        }
    }),
    invariant("a dashboard never lists another actor's private link", async (world) => {
      for (const name of actors) {
        const page = world.actors[name].page;
        if (!page.url().startsWith(`${TINYURL_URL}/links`)) continue;
        const text = await page.locator("body").innerText({ timeout: 10_000 });
        for (const link of world.links)
          if (!canView(name, link) && !link.deleted)
            expect(text, `${name}'s page must not show ${link.slug}`).not.toContain(link.slug);
      }
    }),
  ],
});

const plan = runPlan({ seeds: [4242, 31337], steps: 30, minutes: 5 });

for (const seed of plan.seeds) {
  test(`seed ${seed} keeps tinyurl links visible only to their owners and the public`, async ({
    browser,
  }, testInfo) => {
    await checkUiProperty(testInfo, property(browser), {
      plan,
      seed,
      monitor: {
        origins: [TINYURL_URL, ACCOUNTS_URL],
      },
    });
  });
}
