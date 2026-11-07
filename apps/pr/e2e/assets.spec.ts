import { readFileSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { createCampaign } from "./helpers";

// Images and live posts (Stage 06): rendered by the local Playwright server (e2e/render-server.ts),
// published through e2e/mock-services/img.ts, handed to connpass.
const skills = new URL("../../../skills/", import.meta.url);
const brief = readFileSync(
  new URL("pr-playbook/examples/briefs/devfest-kansai-2026.json", skills),
  "utf8",
);
const assetOutput = JSON.parse(
  readFileSync(new URL("pr-asset/references/example-output.json", skills), "utf8"),
);
const runnerToken = () =>
  /^RUNNER_TOKEN="?([^"\n]+)"?/m.exec(
    readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"),
  )?.[1] ?? "";
const headers = () => ({ authorization: `Bearer ${runnerToken()}`, "x-runner-host": "e2e-runner" });

async function runAssetJob(request: APIRequestContext, output: unknown) {
  const next = await request.get("/api/runner/jobs/next?types=asset&wait=0", {
    headers: headers(),
  });
  expect(next.status()).toBe(200);
  const job = await next.json();
  const bundle = (
    await (await request.get(`/api/runner/jobs/${job.id}/bundle`, { headers: headers() })).json()
  ).files as Record<string, string>;
  const result = await request.post(`/api/runner/jobs/${job.id}/result`, {
    headers: headers(),
    data: { status: "succeeded", result: { output, checks: { yomiyasu: { status: "pass" } } } },
  });
  expect(result.status()).toBe(200);
  return {
    bundle,
    summary: (await result.json()).summary as { assetId: number; mustFails: number },
  };
}

test("a connpass thumbnail is rendered, checked, approved, published and sent to connpass", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const slug = `e2e-img-${Date.now()}`;
  await page.goto("/dev/login?as=lead&chapter=1:gdg-kwansai:organizer&return_to=/");
  await createCampaign(page, slug);
  await page.getByLabel("JSON で読み込む").fill(brief);
  await page.getByRole("button", { name: "JSON を読み込む" }).click();
  await expect(page.getByText("版 1 を保存しました")).toBeVisible();
  await page.goto(`/c/${slug}/settings`);
  await page.getByLabel("connpass グループ").fill("group-1");
  await page.getByLabel("connpass イベント ID").fill("388434");
  await page.getByRole("button", { name: "保存", exact: true }).first().click();

  await page.goto(`/c/${slug}/assets`);
  await page.getByRole("button", { name: "画像を作る" }).click();
  await expect(page.getByText("画像のジョブを積みました")).toBeVisible();

  // Too long a title: rendered, MUST fails, one retry job is queued.
  const long = structuredClone(assetOutput);
  long.layoutVars.titleScale = 1.2;
  long.slots.subcopy = "異分野と越境の AI カンファレンス、関西最大級のデベロッパーイベント";
  const first = await runAssetJob(request, long);
  expect(Object.keys(first.bundle)).toEqual(
    expect.arrayContaining([
      "skills/pr-asset/SKILL.md",
      "skills/pr-playbook/templates/images/connpass-thumbnail/template.html",
      "skills/pr-playbook/scripts/render/image-html.mjs",
    ]),
  );
  expect(first.summary.mustFails).toBeGreaterThan(0);
  const retry = await runAssetJob(request, assetOutput);
  expect(retry.summary.mustFails).toBe(0);

  await page.goto(`/c/${slug}/assets/${retry.summary.assetId}`);
  await expect(page.getByRole("img", { name: "connpass-thumbnail" })).toBeVisible();
  await expect(page.getByText("MUST はすべて OK")).toBeVisible();
  const png = await page.request.get(`/c/${slug}/assets/${retry.summary.assetId}/image`);
  expect(png.headers()["content-type"]).toBe("image/png");
  expect((await png.body()).byteLength).toBeGreaterThan(10_000);

  await page.getByRole("button", { name: "承認して配る" }).click();
  await expect(page.getByText(/img.gdgs.jp に上げました/)).toBeVisible();
  await expect(page.getByText(/connpass にサムネイルを上げるジョブを積みました/)).toBeVisible();
  const state = await (await request.get("/dev/mock-services")).json();
  const upload = state.connpass.jobs
    .filter((j: { type: string }) => j.type === "upload_event_image")
    .at(-1);
  expect(upload.request.contentType).toBe("image/jpeg");
  expect(upload.request.bytes).toBeLessThanOrEqual(1024 * 1024);
});

test("live posts are generated from the timetable, in time order, with cards", async ({ page }) => {
  test.setTimeout(120_000);
  const slug = `e2e-live-${Date.now()}`;
  await page.goto("/dev/login?as=lead&chapter=1:gdg-kwansai:organizer&return_to=/");
  await createCampaign(page, slug);
  await page.getByLabel("JSON で読み込む").fill(brief);
  await page.getByRole("button", { name: "JSON を読み込む" }).click();
  await expect(page.getByText("版 1 を保存しました")).toBeVisible();

  const sessions = (JSON.parse(brief).sessions as { status: string; startAt?: string }[]).filter(
    (s) => s.status === "public" && s.startAt,
  );
  await page.goto(`/c/${slug}/live`);
  await page.getByRole("button", { name: "タイムテーブルから作る" }).click();
  await expect(page.getByText(/実況 \d+ 本（新規 \d+/)).toBeVisible();
  const starts = page
    .getByRole("list", { name: "実況の投稿" })
    .getByRole("listitem")
    .filter({ hasText: "開始" });
  await expect(starts).toHaveCount(sessions.length);
  // Regenerating changes nothing that exists (no duplicates).
  await page.getByRole("button", { name: "タイムテーブルから作る" }).click();
  await expect(page.getByText(/新規 0、更新/)).toBeVisible();
  await expect(starts).toHaveCount(sessions.length);
  // A live post is a normal X draft with the event hashtag.
  await starts.first().getByRole("link").click();
  await expect(page.getByText("#DevFestKansai").first()).toBeVisible();
});
