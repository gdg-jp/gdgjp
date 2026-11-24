import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PageMonitor, UiPropertyWorld } from "@gdgjp/ui-properties";
import { Ui } from "@gdgjp/ui-properties";
import { type APIRequestContext, type Browser, type Page, expect } from "@playwright/test";
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

export type Model = {
  versions: string[];
  status: "in_review" | "approved";
  approvedVersion: number | null;
  targets: Record<Chapter, { status: TargetStatus; approvedVersion: number | null }> | null;
  sends: Send[];
  seen: Record<ActorName, number | null>;
  edits: number;
};

export type PrWorld = UiPropertyWorld & {
  readonly pages: Record<ActorName, Page>;
  readonly request: APIRequestContext;
  readonly draftUrl: string;
  readonly marker: string;
  readonly connpassJobs: number;
  readonly model: Model;
  readonly targetIds: Partial<Record<Chapter, string>>;
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

export const current = (model: Model) => model.versions.length;
export const textOf = (model: Model, version: number) => model.versions[version - 1] ?? "";

type MockState = {
  sns: { posts: { chapterId: number; text: string; actor: string }[] };
  connpass: { jobs?: unknown[] } | unknown[];
};

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
      const first = `${marker} v1 開催決定のお知らせ`;
      const post = {
        ...xOutput.posts[0],
        text: first,
        textAboveFold: first,
        textBelowFold: "",
        attachment: { kind: "none", imageSlots: null, link: null },
      };
      const result = await request.post(`/api/runner/jobs/${job.id}/result`, {
        headers: runner(),
        data: {
          status: "succeeded",
          result: {
            output: { ...xOutput, posts: [post] },
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
        draftUrl,
        marker,
        connpassJobs: connpassJobCount(await mockState(request)),
        targetIds: {},
        model: {
          versions: [first],
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
