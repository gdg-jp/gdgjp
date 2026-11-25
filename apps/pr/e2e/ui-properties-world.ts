import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { PageMonitor, UiPropertyWorld } from "@gdgjp/ui-properties";
import { Ui } from "@gdgjp/ui-properties";
import { type APIRequestContext, type Browser, type Page, expect } from "@playwright/test";
import { CAPTURE_URL } from "./capture-server";
import { createCampaign } from "./helpers";

export const ACTORS = {
  lead: { chapter: "1:gdg-kwansai:organizer", chapters: [1], organizerOf: [1], manage: true },
  osaka: { chapter: "2:gdgoc-osaka:organizer", chapters: [2], organizerOf: [2], manage: false },
  kmember: { chapter: "1:gdg-kwansai:member", chapters: [1], organizerOf: [], manage: false },
  outsider: {
    chapter: "3:gdg-elsewhere:organizer",
    chapters: [3],
    organizerOf: [3],
    manage: false,
  },
} as const;
export type ActorName = keyof typeof ACTORS;
export const ACTOR_NAMES = Object.keys(ACTORS) as ActorName[];
export const CHAPTERS = [1, 2] as const;
export type Chapter = (typeof CHAPTERS)[number];
export type TargetStatus = "pending" | "approved" | "scheduled" | "skipped";

export type Send = { chapterId: number; text: string; actor: string };
export type ExpectedSend = Send & { version: number };

export type Model = {
  versions: string[];
  links: string[];
  approvedVersions: number[];
  status: "in_review" | "approved";
  approvedVersion: number | null;
  targets: Record<Chapter, { status: TargetStatus; approvedVersion: number | null }> | null;
  sends: ExpectedSend[];
  seen: Record<ActorName, number | null>;
  edits: number;
};

export type Outside = { links: number; log: number; tinyurl: number };

export type PrWorld = UiPropertyWorld & {
  readonly pages: Record<ActorName, Page>;
  readonly request: APIRequestContext;
  readonly slug: string;
  readonly campaignId: number;
  readonly draftId: number;
  readonly draftUrl: string;
  readonly marker: string;
  readonly connpassJobs: number;
  readonly model: Model;
  readonly targetIds: Partial<Record<Chapter, string>>;
  refusal: { action: string; before: Outside } | null;
  readonly close: () => Promise<void>;
};

const skills = new URL("../../../skills/", import.meta.url);
const brief = readFileSync(
  new URL("pr-playbook/examples/briefs/devfest-kansai-2026.json", skills),
  "utf8",
);
const xOutput = JSON.parse(
  readFileSync(new URL("pr-x-post/references/example-output.json", skills), "utf8"),
);
const runnerToken = () =>
  /^RUNNER_TOKEN="?([^"\n]+)"?/m.exec(
    readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"),
  )?.[1] ?? "";
const runner = () => ({
  authorization: `Bearer ${runnerToken()}`,
  "x-runner-host": "e2e-property-runner",
});

export const SHORTLINK = "{{shortlink}}";
export const current = (model: Model) => model.versions.length;
export const textOf = (model: Model, version: number) => model.versions[version - 1] ?? "";
export const linkOf = (model: Model, version: number) => model.links[version - 1] ?? "";
export const linkUrl = (marker: string, edit: number) =>
  `${CAPTURE_URL}/event?pbt=${marker}&link=${edit}`;

export type TinyurlLink = { id: string; slug: string; destinationUrl: string };

type MockState = {
  sns: { posts: { chapterId: number; text: string; actor: string }[] };
  tinyurl: { links: TinyurlLink[]; attempts: { slug: string; destinationUrl: string }[] };
  connpass: { jobs?: unknown[] } | unknown[];
};

const persistRoot = () =>
  process.env.PR_E2E_PERSIST_TO ?? fileURLToPath(new URL("../.wrangler/state", import.meta.url));
let databasePath: string | null = null;

function sqliteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sqliteFiles(path);
    return entry.name.endsWith(".sqlite") ? [path] : [];
  });
}

function open(path: string) {
  return new DatabaseSync(path, { readOnly: true });
}

function findDatabase(): string {
  for (const path of sqliteFiles(persistRoot())) {
    const db = open(path);
    try {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'campaign_links'").get())
        return path;
    } finally {
      db.close();
    }
  }
  throw new Error(`no pr D1 database under ${persistRoot()}`);
}

export function queryD1<T>(sql: string, ...params: SQLInputValue[]): T[] {
  databasePath ??= findDatabase();
  const db = open(databasePath);
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

export type LinkRow = {
  tinyurl_link_id: string;
  short_url: string;
  slug: string;
  destination_url: string;
  draft_id: number | null;
  draft_version: number | null;
};

export const linkRows = (world: PrWorld) =>
  queryD1<LinkRow>(
    "SELECT tinyurl_link_id, short_url, slug, destination_url, draft_id, draft_version FROM campaign_links WHERE campaign_id = ? ORDER BY id",
    world.campaignId,
  );

export const ownAttempts = (world: PrWorld, state: MockState) =>
  state.tinyurl.attempts.filter((attempt) => attempt.slug.startsWith(`${world.slug}-`));

export const ownLinks = (world: PrWorld, state: MockState) =>
  state.tinyurl.links.filter((link) => link.slug.startsWith(`${world.slug}-`));

export async function outside(world: PrWorld): Promise<Outside> {
  const state = await mockState(world.request);
  const [log] = queryD1<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dispatch_log WHERE campaign_id = ?",
    world.campaignId,
  );
  return {
    links: linkRows(world).length,
    log: log?.n ?? 0,
    tinyurl: ownAttempts(world, state).length,
  };
}

export function postContent(text: string, url: string) {
  const post = {
    ...xOutput.posts[0],
    text,
    textAboveFold: text,
    textBelowFold: "",
    attachment: { kind: "none", imageSlots: null, link: { url, ogImage: null } },
  };
  return { ...xOutput, posts: [post] };
}

export async function mockState(request: APIRequestContext): Promise<MockState> {
  const response = await request.get("/dev/mock-services");
  expect(response.status()).toBe(200);
  return (await response.json()) as MockState;
}

export function connpassJobCount(state: MockState): number {
  const connpass = state.connpass as { jobs?: unknown[] } | unknown[];
  if (Array.isArray(connpass)) return connpass.length;
  return Array.isArray(connpass.jobs) ? connpass.jobs.length : 0;
}

function jstLocal(minutes: number) {
  return new Date(Date.now() + minutes * 60_000 + 9 * 3600_000).toISOString().slice(0, 16);
}

async function drainJobs(request: APIRequestContext, types: string) {
  for (let index = 0; index < 20; index++) {
    const next = await request.get(`/api/runner/jobs/next?types=${types}&wait=0`, {
      headers: runner(),
    });
    if (next.status() === 204) return;
    const job = (await next.json()) as { id: string };
    await request.post(`/api/runner/jobs/${job.id}/result`, {
      headers: runner(),
      data: { status: "failed", error: "drained by the property setup", retry: false },
    });
  }
}

async function signIn(page: Page, actor: ActorName) {
  await page.goto(`/dev/login?as=${actor}&chapter=${ACTORS[actor].chapter}&return_to=/`);
}

export function createWorld(browser: Browser) {
  return async (monitor: PageMonitor): Promise<PrWorld> => {
    const contexts = await Promise.all(
      ACTOR_NAMES.map(() => browser.newContext({ locale: "ja-JP" })),
    );
    contexts.forEach((context, index) => {
      if (ACTOR_NAMES[index] !== "outsider") monitor.watchContext(context);
    });
    const pages = Object.fromEntries(
      await Promise.all(
        ACTOR_NAMES.map(async (name, index) => [name, await contexts[index]?.newPage()]),
      ),
    ) as Record<ActorName, Page>;
    const close = async () => {
      for (const context of contexts) await context.close();
    };
    try {
      const lead = pages.lead;
      const request = lead.request;
      const slug = `pbt-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
      const marker = `PBT-${randomUUID().slice(0, 8)}`;
      for (const name of ACTOR_NAMES) await signIn(pages[name], name);
      await createCampaign(lead, slug);
      await lead.getByLabel("JSON で読み込む").fill(brief);
      await lead.getByRole("button", { name: "JSON を読み込む" }).click();
      await expect(lead.getByText("版 1 を保存しました")).toBeVisible();
      await lead.goto(`/c/${slug}/members`);
      await lead.getByLabel("チャプター ID").fill("2");
      await lead.getByLabel("チャプター名").fill("gdgoc-osaka");
      await lead.getByRole("button", { name: "共催に追加" }).click();
      await expect(lead.getByText("gdgoc-osaka").first()).toBeVisible();
      for (const [name, label] of [
        ["lead", "@chapter1"],
        ["osaka", "@chapter2"],
      ] as const) {
        const page = pages[name];
        await page.goto(`/c/${slug}/settings`);
        await page.getByRole("button", { name: "追加", exact: true }).first().click();
        await expect(page.getByText(`${label} を配信先に追加しました`)).toBeVisible();
      }
      await lead.goto(`/c/${slug}/settings`);
      await lead.getByRole("button", { name: "有効化" }).click();
      await expect(lead.getByText(/有効化しました（チャネル \d+ 本）/)).toBeVisible();
      await drainJobs(request, "post");
      await lead.goto(`/c/${slug}/schedule`);
      await lead.getByRole("button", { name: "アイテムを追加" }).click();
      await lead.getByLabel("日時").fill(jstLocal(90));
      await lead.getByLabel("タイトル").fill("PBT 告知");
      await lead.getByRole("button", { name: "追加", exact: true }).click();
      await lead.getByLabel("「PBT 告知」の下書きを作る").check();
      await lead.getByRole("button", { name: "選んだ投稿の下書きを runner に頼む" }).click();
      await expect(lead.getByText(/件の下書きを runner に頼みました/)).toBeVisible();
      const next = await request.get("/api/runner/jobs/next?types=post&wait=0", {
        headers: runner(),
      });
      expect(next.status()).toBe(200);
      const job = (await next.json()) as { id: string };
      const first = `${marker} v1 開催決定のお知らせ ${SHORTLINK}`;
      const firstLink = linkUrl(marker, 0);
      const result = await request.post(`/api/runner/jobs/${job.id}/result`, {
        headers: runner(),
        data: {
          status: "succeeded",
          result: {
            output: postContent(first, firstLink),
            checks: { yomiyasu: { status: "pass" } },
          },
        },
      });
      expect(result.status()).toBeLessThan(300);
      await drainJobs(request, "fix");
      await lead.goto(`/c/${slug}/drafts`);
      await lead.getByRole("link", { name: "PBT 告知" }).click();
      await lead.waitForURL(/\/drafts\/\d+$/);
      const draftUrl = new URL(lead.url()).pathname;
      const draftId = Number(/\/drafts\/(\d+)$/.exec(draftUrl)?.[1]);
      const campaignId = queryD1<{ id: number }>("SELECT id FROM campaigns WHERE slug = ?", slug)[0]
        ?.id;
      if (!campaignId) throw new Error(`campaign ${slug} is not in D1`);
      const seen = Object.fromEntries(ACTOR_NAMES.map((name) => [name, null])) as Record<
        ActorName,
        number | null
      >;
      seen.lead = 1;
      return {
        ui: new Ui(monitor),
        monitor,
        pages,
        request,
        slug,
        campaignId,
        draftId,
        draftUrl,
        marker,
        connpassJobs: connpassJobCount(await mockState(request)),
        targetIds: {},
        refusal: null,
        model: {
          versions: [first],
          links: [firstLink],
          approvedVersions: [],
          status: "in_review",
          approvedVersion: null,
          targets: null,
          sends: [],
          seen,
          edits: 0,
        },
        close,
      };
    } catch (error) {
      await close();
      throw error;
    }
  };
}
