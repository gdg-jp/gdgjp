import { readFileSync } from "node:fs";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { createCampaign } from "./helpers";

const skills = new URL("../../../skills/", import.meta.url);
const brief = readFileSync(
  new URL("pr-playbook/examples/briefs/devfest-kansai-2026.json", skills),
  "utf8",
);
const copyOutput = JSON.parse(
  readFileSync(new URL("pr-copy/references/example-output.json", skills), "utf8"),
);

function runnerToken(): string {
  const vars = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
  const match = /^RUNNER_TOKEN="?([^"\n]+)"?/m.exec(vars);
  if (!match?.[1]) throw new Error("RUNNER_TOKEN missing from apps/pr/.dev.vars");
  return match[1];
}

const headers = () => ({ authorization: `Bearer ${runnerToken()}`, "x-runner-host": "e2e-runner" });

async function runOneJob(request: APIRequestContext, output: unknown) {
  const next = await request.get("/api/runner/jobs/next?types=copy&wait=0", { headers: headers() });
  expect(next.status()).toBe(200);
  const job = await next.json();
  const bundle = await request.get(`/api/runner/jobs/${job.id}/bundle`, { headers: headers() });
  expect(bundle.status()).toBe(200);
  const files = (await bundle.json()).files as Record<string, string>;
  expect(Object.keys(files)).toEqual(
    expect.arrayContaining([
      "JOB.md",
      "BRIEF.json",
      "skills/pr-copy/SKILL.md",
      "skills/pr-playbook/rules.json",
    ]),
  );
  const result = await request.post(`/api/runner/jobs/${job.id}/result`, {
    headers: headers(),
    data: { status: "succeeded", result: { output, checks: { yomiyasu: { status: "pass" } } } },
  });
  expect(result.status()).toBe(200);
  return result.json();
}

async function setUp(page: Page, slug: string) {
  await page.goto("/dev/login?as=lead&chapter=1:gdg-kwansai:organizer&return_to=/");
  await createCampaign(page, slug);
  await page.getByLabel("JSON で読み込む").fill(brief);
  await page.getByRole("button", { name: "JSON を読み込む" }).click();
  await expect(page.getByText("版 1 を保存しました")).toBeVisible();
}

test("only a super admin opens /admin/runner", async ({ browser }) => {
  const visits = [
    ["as=runner-member&chapter=1:gdg-kwansai:member", 404],
    ["as=runner-organizer&chapter=1:gdg-kwansai:organizer", 404],
    ["as=runner-admin&chapter=1:gdg-kwansai:member&admin=1", 200],
  ] as const;
  for (const [login, status] of visits) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/dev/login?${login}&return_to=/settings`);
    await expect
      .soft(page.getByRole("link", { name: "詳しく" }), login)
      .toHaveCount(status === 200 ? 1 : 0);
    const response = await page.goto("/admin/runner");
    expect.soft(response?.status(), login).toBe(status);
    if (status === 200) await expect(page.getByRole("heading", { name: "キュー" })).toBeVisible();
    await context.close();
  }
});

test("the runner API rejects a wrong token", async ({ request }) => {
  const response = await request.get("/api/runner/jobs/next?types=copy", {
    headers: { authorization: "Bearer nope" },
  });
  expect(response.status()).toBe(401);
});

test("a runner's copy goes through review and approval; a failing draft gets one fix", async ({
  page,
  request,
}) => {
  const slug = `e2e-run-${Date.now()}`;
  await setUp(page, slug);
  await page.goto(`/c/${slug}/plan`);
  await page.getByRole("button", { name: "コピーを作る" }).click();
  await expect(page.getByText("コピーのジョブを積みました")).toBeVisible();

  const bad = structuredClone(copyOutput);
  bad.candidates[0].connpassTitle = "DevFest Kansai 2026";
  const first = await runOneJob(request, bad);
  expect(first.summary.mustFails).toBeGreaterThan(0);
  const fix = await request.get("/api/runner/jobs/next?types=fix&wait=0", { headers: headers() });
  expect(fix.status()).toBe(200);
  const fixJob = await fix.json();
  await request.post(`/api/runner/jobs/${fixJob.id}/result`, {
    headers: headers(),
    data: {
      status: "succeeded",
      result: { output: copyOutput, checks: { yomiyasu: { status: "pass" } } },
    },
  });

  await page.goto(`/c/${slug}/reviews`);
  await page.getByRole("link", { name: "タイトルとメインコピー" }).click();
  await expect(page.getByText("MUST はすべて OK")).toBeVisible();
  await expect(page.getByRole("link", { name: /版 2/ })).toBeVisible();
  await page.getByRole("button", { name: "レビュー OK（承認に回す）" }).click();
  await expect(page.getByText("承認待ち", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "承認", exact: true }).click();
  await expect(page.getByText("承認済み", { exact: true })).toBeVisible();

  await page.getByLabel("JSON").fill(JSON.stringify({ ...copyOutput, notes: "人が直した" }));
  await page.getByRole("button", { name: "新しい版として保存" }).click();
  await expect(page.getByText("版 3 を保存しました")).toBeVisible();
  await expect(page.getByText("レビュー待ち", { exact: true }).first()).toBeVisible();
});
