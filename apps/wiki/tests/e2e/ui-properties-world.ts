import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PageMonitor, UiPropertyWorld } from "@gdgjp/ui-properties";
import { Ui } from "@gdgjp/ui-properties";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import {
  DEFAULT_E2E_PERSISTENCE_PATH,
  E2E_PERSISTENCE_ENV,
  USERS,
  resolveE2EPersistencePath,
} from "./setup";

export type Role = "author" | "member";
export type PageKey = "a" | "b";
export type Display = { small: boolean; full: boolean };
export type FixturePage = { id: string; path: string; title: string; marker: string };

export type NavigationSample = {
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

export type Actor = {
  readonly role: Role;
  readonly page: Page;
  readonly context: BrowserContext;
  at: PageKey | null;
  readonly display: Record<PageKey, Display>;
};

export type WikiWorld = UiPropertyWorld & {
  readonly actors: Record<Role, Actor>;
  readonly pages: Record<PageKey, FixturePage>;
  readonly samples: NavigationSample[];
  readonly baseline: Record<PageKey, unknown>;
};

const appDirectory = fileURLToPath(new URL("../../", import.meta.url));
const storageDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "storage-state");
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

function fixtures(): Record<PageKey, FixturePage> {
  const suffix = randomUUID();
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

export function createWorld(
  browser: Browser,
  viewport: { width: number; height: number },
  samples: NavigationSample[],
) {
  return async (monitor: PageMonitor): Promise<WikiWorld> => {
    const pages = fixtures();
    seedPages(pages);
    const actor = async (role: Role): Promise<Actor> => {
      const context = await browser.newContext({
        storageState: path.join(storageDirectory, `${role}.json`),
        viewport,
      });
      monitor.watchContext(context);
      const page = await context.newPage();
      const fresh = (): Display => ({ small: false, full: false });
      return { role, page, context, at: null, display: { a: fresh(), b: fresh() } };
    };
    const actors = { author: await actor("author"), member: await actor("member") };
    const baseline: Record<PageKey, unknown> = { a: null, b: null };
    for (const key of ["a", "b"] as const) {
      const response = await actors.author.page.request.get(`/api/page-access/${pages[key].id}`);
      if (response.status() !== 200)
        throw new Error(`page-access for ${key} returned ${response.status()}`);
      baseline[key] = await response.json();
    }
    return { ui: new Ui(monitor), monitor, actors, pages, samples, baseline };
  };
}

export async function destroyWorld(world: WikiWorld): Promise<void> {
  try {
    for (const actor of Object.values(world.actors)) await actor.context.close();
  } finally {
    cleanupPages(world.pages);
  }
}

export async function navigate(world: WikiWorld, actor: Actor, key: PageKey, reload = false) {
  const target = world.pages[key];
  const evidence = `${reload ? "reload" : "goto"} ${target.id}`;
  try {
    const response = reload
      ? await actor.page.reload({ waitUntil: "load" })
      : await actor.page.goto(target.path, { waitUntil: "load" });
    if (response?.status() !== 200)
      throw new Error(`${evidence} returned ${response?.status() ?? "no response"}`);
    const entry = await actor.page.evaluate(() => {
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
    if (entry)
      world.samples.push({
        observedAt: new Date().toISOString(),
        ...entry,
        outcome: "success",
        evidence,
        httpStatus: response.status(),
      });
    actor.at = key;
  } catch (error) {
    world.samples.push({
      observedAt: new Date().toISOString(),
      url: new URL(target.path, process.env.BASE_URL).href,
      outcome: "failed",
      evidence: `${evidence}: ${String(error)}`,
    });
    throw error;
  }
}
