import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  DEFAULT_E2E_PERSISTENCE_PATH,
  E2E_PERSISTENCE_ENV,
  USERS,
  resolveE2EPersistencePath,
} from "./setup";

type Role = "author" | "member";
type PageKey = "a" | "b";
type Action = { role: Role; page: PageKey; kind: "toggle" | "share" | "reload" };
type FixturePage = { id: string; path: string; title: string; marker: string };
type NavigationSample = {
  observedAt: string;
  url: string;
  outcome: "success" | "failed";
  evidence: string;
  httpStatus?: number;
  navigation?: {
    duration: number;
    responseStart: number;
    domContentLoadedEventEnd: number;
    loadEventEnd: number;
  };
};

const appDirectory = fileURLToPath(new URL("../../", import.meta.url));
const more = (page: Page) => page.getByRole("button", { name: /More actions|その他の操作/ });
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

function localD1(sql: string): void {
  resolveE2EPersistencePath(
    process.env[E2E_PERSISTENCE_ENV] ?? DEFAULT_E2E_PERSISTENCE_PATH,
    appDirectory,
  );
  execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "gdgjp-wiki-db",
      "--local",
      "--persist-to",
      DEFAULT_E2E_PERSISTENCE_PATH,
      "--command",
      sql,
      "--json",
    ],
    { cwd: appDirectory, stdio: "pipe", timeout: 30_000 },
  );
}

function fixtures(seed: number): Record<PageKey, FixturePage> {
  const suffix = `${seed}-${randomUUID()}`;
  const make = (key: PageKey): FixturePage => ({
    id: `ui-property-${key}-${suffix}`,
    path: `/s/gdg-jp/wiki/ui-property-${key}-${suffix}?lang=en`,
    title: `Property ${key.toUpperCase()} ${suffix}`,
    marker: `Access ${key.toUpperCase()} ${suffix}`,
  });
  return { a: make("a"), b: make("b") };
}

function seedPages(pages: Record<PageKey, FixturePage>): void {
  localD1(
    Object.values(pages)
      .map((page) => {
        const slug = new URL(page.path, "http://localhost").pathname.split("/").at(-1);
        if (!slug) throw new Error("Fixture page is missing its slug");
        const content = `## Seeded property page\n\n${page.title}`;
        return `INSERT INTO pages (id, space_id, slug, title_ja, title_en, content_ja, content_en, author_id, last_edited_by, visibility, general_role, acl_synced_with_parent)
          VALUES (${quote(page.id)}, 'gdg-jp', ${quote(slug)}, ${quote(page.title)}, ${quote(page.title)}, ${quote(content)}, ${quote(content)}, ${quote(USERS.author.id)}, ${quote(USERS.author.id)}, 'unlisted', 'viewer', 0);
          INSERT INTO page_access (id, page_id, subject_type, subject_key, subject_label, role, granted_by)
          VALUES (${quote(`${page.id}-access`)}, ${quote(page.id)}, 'email', ${quote(`${page.id}@test.local`)}, ${quote(page.marker)}, 'viewer', ${quote(USERS.author.id)});`;
      })
      .join("\n"),
  );
}

function cleanupPages(pages: Record<PageKey, FixturePage>): void {
  const ids = Object.values(pages)
    .map((page) => quote(page.id))
    .join(",");
  localD1(
    `DELETE FROM page_access WHERE page_id IN (${ids}); DELETE FROM pages WHERE id IN (${ids});`,
  );
}

function actions(seed: number): Action[] {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const generated = (): Action => ({
    role: (next() >>> 16) % 2 === 0 ? "author" : "member",
    page: (next() >>> 16) % 2 === 0 ? "a" : "b",
    kind: (next() >>> 16) % 2 === 0 ? "toggle" : "share",
  });
  return [
    { role: "author", page: "a", kind: "toggle" },
    { role: "author", page: "b", kind: "share" },
    { role: "member", page: "a", kind: "share" },
    { role: "member", page: "b", kind: "toggle" },
    { role: "author", page: "a", kind: "share" },
    { role: "member", page: "b", kind: "share" },
    generated(),
    generated(),
    { role: "author", page: "a", kind: "reload" },
    { role: "author", page: "b", kind: "reload" },
    { role: "member", page: "a", kind: "reload" },
    { role: "member", page: "b", kind: "reload" },
  ];
}

async function navigate(
  page: Page,
  target: FixturePage,
  samples: NavigationSample[],
  reload = false,
): Promise<void> {
  const evidence = `${reload ? "reload" : "goto"} ${target.id}`;
  try {
    const response = reload
      ? await page.reload({ waitUntil: "load" })
      : await page.goto(target.path, { waitUntil: "load" });
    expect(response?.status()).toBe(200);
    await page.waitForFunction(() =>
      performance
        .getEntriesByType("navigation")
        .some((entry) => entry instanceof PerformanceNavigationTiming && entry.loadEventEnd > 0),
    );
    const entry = await page.evaluate(() => {
      const timing = performance
        .getEntriesByType("navigation")
        .find(
          (item): item is PerformanceNavigationTiming =>
            item instanceof PerformanceNavigationTiming,
        );
      if (!timing || timing.duration <= 0 || timing.loadEventEnd <= 0) return null;
      return {
        url: timing.name,
        navigation: {
          duration: timing.duration,
          responseStart: timing.responseStart,
          domContentLoadedEventEnd: timing.domContentLoadedEventEnd,
          loadEventEnd: timing.loadEventEnd,
        },
      };
    });
    if (!entry) throw new Error("Completed document navigation timing is unavailable");
    samples.push({
      observedAt: new Date().toISOString(),
      ...entry,
      outcome: "success",
      evidence,
      httpStatus: response?.status(),
    });
  } catch (error) {
    samples.push({
      observedAt: new Date().toISOString(),
      url: page.url().startsWith("http")
        ? page.url()
        : new URL(target.path, process.env.BASE_URL).href,
      outcome: "failed",
      evidence: `${evidence}: ${String(error)}`,
    });
    throw error;
  }
}

async function assertPage(page: Page, target: FixturePage, smallText: boolean): Promise<void> {
  await expect(
    page.getByRole("heading", { level: 1, name: target.title, exact: true }),
  ).toBeVisible();
  await expect(more(page)).toBeEnabled();
  await expect(page.locator("article:visible")).toHaveAttribute(
    "data-small-text",
    String(smallText),
  );
}

async function sharing(
  page: Page,
  target: FixturePage,
  other: FixturePage,
  role: Role,
): Promise<void> {
  const share = page.getByRole("button", { name: "Share", exact: true });
  if (await share.isVisible()) {
    await share.click();
  } else {
    await more(page).click();
    await page.getByRole("menuitem", { name: "Share", exact: true }).click();
  }
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading").filter({ hasText: target.title })).toBeVisible();
  await expect(dialog.getByRole("listitem").filter({ hasText: target.marker })).toBeVisible();
  await expect(dialog.getByText(other.marker, { exact: true })).toHaveCount(0);
  if (role === "member") {
    await expect(dialog.getByRole("combobox")).toHaveCount(0);
  } else {
    await expect(
      dialog.getByRole("combobox", { name: "General access", exact: true }),
    ).toBeEnabled();
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

async function assertAccess(page: Page, target: FixturePage, other: FixturePage, role: Role) {
  const response = await page.request.get(`/api/page-access/${target.id}`);
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  expect(body).toMatchObject({
    myRole: role === "author" ? "owner" : "viewer",
    canManageSharing: role === "author",
    generalAccess: "unlisted",
    generalRole: "viewer",
    accessList: expect.arrayContaining([expect.objectContaining({ subjectLabel: target.marker })]),
  });
  expect(JSON.stringify(body)).not.toContain(other.marker);
  if (role === "member") {
    await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    await more(page).click();
    await expect(page.getByRole("menuitem", { name: "Edit", exact: true })).toHaveCount(0);
    for (const name of ["Duplicate", "Move to", "Move to Trash"]) {
      await expect(page.getByRole("menuitem", { name, exact: true })).toBeDisabled();
    }
    await page.keyboard.press("Escape");
    expect(
      (await page.request.post(target.path, { form: { intent: "duplicatePage" } })).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post(`/api/page-access/${target.id}`, {
          data: { intent: "setGeneralAccess", visibility: "public", generalRole: "editor" },
        })
      ).status(),
    ).toBe(403);
    expect((await page.request.get("/admin/runner")).status()).toBe(403);
    const unchanged = await page.request.get(`/api/page-access/${target.id}`);
    expect(unchanged.status()).toBe(200);
    expect(await unchanged.json()).toEqual(body);
  }
  return body;
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  for (const seed of [1701, 9127]) {
    test(`seed ${seed} preserves page display and access across ${viewport.name} actions`, async ({
      authorPage,
      memberPage,
    }, testInfo) => {
      test.setTimeout(180_000);
      const pages = fixtures(seed);
      const actors = { author: authorPage, member: memberPage };
      const expected = { author: { a: false, b: false }, member: { a: false, b: false } };
      const sequence = actions(seed);
      const observations: unknown[] = [];
      const samples: NavigationSample[] = [];
      let failedPrefix: { actions: Action[]; error: string } | null = null;
      let prefixLength = 0;
      try {
        seedPages(pages);
        await authorPage.setViewportSize(viewport);
        await memberPage.setViewportSize(viewport);
        for (const action of sequence) {
          prefixLength++;
          const page = actors[action.role];
          const target = pages[action.page];
          const other = pages[action.page === "a" ? "b" : "a"];
          await test.step(`${prefixLength}: ${action.role} ${action.page} ${action.kind}`, async () => {
            await navigate(page, target, samples);
            await assertPage(page, target, expected[action.role][action.page]);
            if (action.kind === "toggle") {
              await more(page).click();
              await page.getByRole("menuitemcheckbox", { name: "Small text" }).click();
              expected[action.role][action.page] = !expected[action.role][action.page];
              await page.keyboard.press("Escape");
              await assertPage(page, target, expected[action.role][action.page]);
              await navigate(page, target, samples, true);
            } else if (action.kind === "share") {
              await sharing(page, target, other, action.role);
            } else {
              await navigate(page, target, samples, true);
            }
            await assertPage(page, target, expected[action.role][action.page]);
            const access = await assertAccess(page, target, other, action.role);
            observations.push({
              action,
              url: page.url(),
              expectedSmallText: expected[action.role][action.page],
              observedSmallText: await page
                .locator("article:visible")
                .getAttribute("data-small-text"),
              access,
            });
          });
        }
      } catch (error) {
        failedPrefix = { actions: sequence.slice(0, prefixLength), error: String(error) };
        throw error;
      } finally {
        await testInfo.attach("seeded-ui-actions.json", {
          body: JSON.stringify(
            { seed, viewport, sequence, observations, expected, failedPrefix },
            null,
            2,
          ),
          contentType: "application/json",
        });
        await testInfo.attach("synthetic-navigation.json", {
          body: JSON.stringify({
            kind: "synthetic-navigation",
            collectedAt: new Date().toISOString(),
            source: "playwright-local",
            samples,
          }),
          contentType: "application/json",
        });
        cleanupPages(pages);
      }
    });
  }
}
