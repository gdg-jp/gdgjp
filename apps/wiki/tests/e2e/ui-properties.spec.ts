import { type UiProperty, action, checkUiProperty, invariant, runPlan } from "@gdgjp/ui-properties";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  type Actor,
  type NavigationSample,
  type PageKey,
  type Role,
  type WikiWorld,
  createWorld,
  destroyWorld,
  navigate,
} from "./ui-properties-world";

test.describe.configure({ retries: 0 });

const more = (page: Page) => page.getByRole("button", { name: /More actions|その他の操作/ });
const other = (key: PageKey): PageKey => (key === "a" ? "b" : "a");
const roles: readonly Role[] = ["author", "member"];
const keys: readonly PageKey[] = ["a", "b"];
type Target = { role: Role; page: PageKey };

const target = (random: { pick<T>(items: readonly T[]): T }): Target => ({
  role: random.pick(roles),
  page: random.pick(keys),
});

async function ensureOn(world: WikiWorld, actor: Actor, key: PageKey) {
  if (actor.at !== key || !actor.page.url().includes(world.pages[key].id))
    await navigate(world, actor, key);
}

async function toggleDisplay(world: WikiWorld, input: Target, setting: "small" | "full") {
  const actor = world.actors[input.role];
  await ensureOn(world, actor, input.page);
  await world.ui.click(more(actor.page));
  await world.ui.click(
    actor.page.getByRole("menuitemcheckbox", {
      name: setting === "small" ? "Small text" : "Full width",
    }),
  );
  actor.display[input.page][setting] = !actor.display[input.page][setting];
  await actor.page.keyboard.press("Escape");
}

async function openSharing(world: WikiWorld, input: Target) {
  const actor = world.actors[input.role];
  await ensureOn(world, actor, input.page);
  const share = actor.page.getByRole("button", { name: "Share", exact: true });
  if (await share.isVisible()) await world.ui.click(share);
  else {
    await world.ui.click(more(actor.page));
    await world.ui.click(actor.page.getByRole("menuitem", { name: "Share", exact: true }));
  }
  const dialog = actor.page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const page = world.pages[input.page];
  await expect(dialog.getByRole("heading").filter({ hasText: page.title })).toBeVisible();
  await expect(dialog.getByRole("listitem").filter({ hasText: page.marker })).toBeVisible();
  await expect(
    dialog.getByText(world.pages[other(input.page)].marker, { exact: true }),
  ).toHaveCount(0);
  if (input.role === "member") await expect(dialog.getByRole("combobox")).toHaveCount(0);
  else
    await expect(
      dialog.getByRole("combobox", { name: "General access", exact: true }),
    ).toBeEnabled();
  await actor.page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

const property: (
  browser: Parameters<typeof createWorld>[0],
  viewport: { width: number; height: number },
  samples: NavigationSample[],
) => UiProperty<WikiWorld> = (browser, viewport, samples) => ({
  name: "wiki page display and access",
  setup: createWorld(browser, viewport, samples),
  teardown: destroyWorld,
  actions: [
    action<WikiWorld, Target>({
      name: "open page",
      weight: 3,
      input: target,
      run: (world, input) => navigate(world, world.actors[input.role], input.page),
    }),
    action<WikiWorld, Target>({
      name: "toggle small text",
      weight: 3,
      input: target,
      run: (world, input) => toggleDisplay(world, input, "small"),
    }),
    action<WikiWorld, Target>({
      name: "toggle full width",
      weight: 2,
      input: target,
      run: (world, input) => toggleDisplay(world, input, "full"),
    }),
    action<WikiWorld, Target>({
      name: "open sharing",
      weight: 3,
      input: target,
      run: openSharing,
    }),
    action<WikiWorld, { role: Role }>({
      name: "reload",
      weight: 2,
      enabled: (world) => roles.some((role) => world.actors[role].at !== null),
      input: (random, world) => ({
        role: random.pick(roles.filter((role) => world.actors[role].at !== null)),
      }),
      run: async (world, input) => {
        const actor = world.actors[input.role];
        if (actor.at) await navigate(world, actor, actor.at, true);
      },
    }),
    action<WikiWorld, { page: PageKey }>({
      name: "member tries to widen access",
      weight: 2,
      input: (random) => ({ page: random.pick(keys) }),
      run: async (world, input) => {
        const { page } = world.actors.member;
        const fixture = world.pages[input.page];
        const attempts = [
          await page.request.post(fixture.path, { form: { intent: "duplicatePage" } }),
          await page.request.post(`/api/page-access/${fixture.id}`, {
            data: { intent: "setGeneralAccess", visibility: "public", generalRole: "editor" },
          }),
          await page.request.post(`/api/page-access/${fixture.id}`, {
            data: {
              intent: "add",
              subjectType: "email",
              subjectKey: "member@test.local",
              role: "owner",
            },
          }),
          await page.request.post(`/api/page-access/${fixture.id}`, {
            data: { intent: "transfer", userId: "e2e-member-user-id" },
          }),
          await page.request.get("/admin/runner"),
        ];
        for (const response of attempts)
          expect(response.status(), `${response.url()} must refuse the member`).toBe(403);
      },
    }),
    action<WikiWorld, { page: PageKey }>({
      name: "member opens the page menu",
      weight: 1,
      input: (random) => ({ page: random.pick(keys) }),
      run: async (world, input) => {
        const actor = world.actors.member;
        await ensureOn(world, actor, input.page);
        await expect(actor.page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
        await world.ui.click(more(actor.page));
        await expect(actor.page.getByRole("menuitem", { name: "Edit", exact: true })).toHaveCount(
          0,
        );
        for (const name of ["Duplicate", "Move to", "Move to Trash"])
          await expect(actor.page.getByRole("menuitem", { name, exact: true })).toBeDisabled();
        await actor.page.keyboard.press("Escape");
      },
    }),
  ],
  invariants: [
    invariant("each actor sees its own display settings for the page it is on", async (world) => {
      for (const actor of Object.values(world.actors)) {
        if (!actor.at) continue;
        const page = world.pages[actor.at];
        await expect(
          actor.page.getByRole("heading", { level: 1, name: page.title, exact: true }),
        ).toBeVisible();
        await expect(more(actor.page)).toBeEnabled();
        await expect(actor.page.locator("article:visible")).toHaveAttribute(
          "data-small-text",
          String(actor.display[actor.at].small),
        );
      }
    }),
    invariant("access never widens and never leaks across pages", async (world) => {
      for (const key of keys) {
        const fixture = world.pages[key];
        for (const role of roles) {
          const response = await world.actors[role].page.request.get(
            `/api/page-access/${fixture.id}`,
          );
          expect(response.status()).toBe(200);
          const body: unknown = await response.json();
          expect(body).toMatchObject({
            myRole: role === "author" ? "owner" : "viewer",
            canManageSharing: role === "author",
            generalAccess: "unlisted",
            generalRole: "viewer",
          });
          expect(JSON.stringify(body)).not.toContain(world.pages[other(key)].marker);
          if (role === "author") expect(body).toEqual(world.baseline[key]);
        }
      }
    }),
  ],
});

const plan = runPlan({ seeds: [1701, 9127], steps: 120, minutes: 8 });

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  for (const seed of plan.seeds) {
    test(`seed ${seed} keeps page display and access consistent on ${viewport.name}`, async ({
      browser,
    }, testInfo) => {
      test.info().annotations.push({ type: "ui-property-seed", description: String(seed) });
      const samples: NavigationSample[] = [];
      try {
        await checkUiProperty(testInfo, property(browser, viewport, samples), {
          plan,
          seed,
          monitor: {
            origins: [new URL(process.env.BASE_URL ?? "http://localhost:6177").origin],
            ignoreConsole: [/net::ERR_NAME_NOT_RESOLVED/],
          },
        });
      } finally {
        await testInfo.attach("synthetic-navigation.json", {
          body: JSON.stringify({
            kind: "synthetic-navigation",
            collectedAt: new Date().toISOString(),
            source: "playwright-local",
            samples,
          }),
          contentType: "application/json",
        });
      }
    });
  }
}
