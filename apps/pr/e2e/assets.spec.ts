import { readFileSync } from "node:fs";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { createCampaign } from "./helpers";

// Images and live posts (Stage 06), and the design kit: rendered by the local Playwright server
// (e2e/render-server.ts), published through e2e/mock-services/img.ts, handed to connpass.
const skills = new URL("../../../skills/", import.meta.url);
const brief = readFileSync(
  new URL("pr-playbook/examples/briefs/devfest-kansai-2026.json", skills),
  "utf8",
);
const templateOutput = JSON.parse(
  readFileSync(new URL("pr-asset/references/example-template-output.json", skills), "utf8"),
);
const designOutput = JSON.parse(
  readFileSync(new URL("pr-asset/references/example-output.json", skills), "utf8"),
);
const thumbnailHtml = readFileSync(
  new URL("pr-playbook/examples/design/html/connpass-thumbnail.html", skills),
  "utf8",
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
  const bundleBody = await (
    await request.get(`/api/runner/jobs/${job.id}/bundle`, { headers: headers() })
  ).json();
  const result = await request.post(`/api/runner/jobs/${job.id}/result`, {
    headers: headers(),
    data: { status: "succeeded", result: { output, checks: { yomiyasu: { status: "pass" } } } },
  });
  expect(result.status()).toBe(200);
  return {
    bundle: bundleBody.files as Record<string, string>,
    bundleBody: bundleBody as { workspaceWrite?: boolean; render?: boolean; images?: string[] },
    summary: (await result.json()).summary as {
      assetId?: number;
      assetIds?: number[];
      directions?: number;
      mustFails: number;
    },
  };
}

async function startWithBrief(page: Page, slug: string) {
  await page.goto("/dev/login?as=lead&chapter=1:gdg-kwansai:organizer&return_to=/");
  await createCampaign(page, slug);
  await page.getByLabel("JSON で読み込む").fill(brief);
  await page.getByRole("button", { name: "JSON を読み込む" }).click();
  await expect(page.getByText("版 1 を保存しました")).toBeVisible();
}

test("a connpass thumbnail (template mode) is rendered, checked, approved, published and sent to connpass", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const slug = `e2e-img-${Date.now()}`;
  await startWithBrief(page, slug);
  await page.goto(`/c/${slug}/settings`);
  await page.getByLabel("connpass グループ").fill("group-1");
  await page.getByLabel("connpass イベント ID").fill("388434");
  await page.getByRole("button", { name: "保存", exact: true }).first().click();

  await page.goto(`/c/${slug}/assets`);
  await page.getByRole("button", { name: "画像を作る" }).click();
  await expect(page.getByText("画像を頼みました")).toBeVisible();

  // Too long a title: rendered, MUST fails, one retry job is queued.
  const long = structuredClone(templateOutput);
  long.layoutVars.titleScale = 1.2;
  long.slots.subcopy = "異分野と越境の AI カンファレンス、関西最大級のデベロッパーイベント";
  const first = await runAssetJob(request, long);
  expect(Object.keys(first.bundle)).toEqual(
    expect.arrayContaining([
      "skills/pr-asset/SKILL.md",
      "skills/pr-playbook/guides/design.md",
      "skills/pr-playbook/templates/images/connpass-thumbnail/template.html",
      "skills/pr-playbook/scripts/render/image-html.mjs",
      "skills/pr-playbook/scripts/render/design-html.mjs",
      "skills/pr-playbook/scripts/render/broker.mjs",
      "assets/gdg.svg",
      "assets/stickers/16-hash-outline.svg",
    ]),
  );
  expect(first.bundleBody.workspaceWrite).toBe(true);
  expect(first.bundleBody.render).toBe(true);
  expect(first.summary.mustFails).toBeGreaterThan(0);
  const retry = await runAssetJob(request, templateOutput);
  expect(retry.bundle["PREVIOUS.html"]).toContain("canvas");
  expect(retry.bundle["CHECKS.json"]).toContain("RENDER-");
  expect(retry.summary.mustFails).toBe(0);

  await page.goto(`/c/${slug}/assets/${retry.summary.assetId}`);
  await expect(page.getByRole("img", { name: "connpass のサムネイル（顔）" })).toBeVisible();
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

test("the design kit: directions from the agent's HTML, one adopted, then a session card in the same kit", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const slug = `e2e-kit-${Date.now()}`;
  await startWithBrief(page, slug);

  // The home page nudges: no kit yet.
  await page.goto("/");
  await expect(
    page.getByText("イベントのデザインキット（色と顔）がまだありません").first(),
  ).toBeVisible();

  await page.goto(`/c/${slug}/assets`);
  await page.getByRole("button", { name: "キットと顔の案を作る" }).click();
  await expect(page.getByText("キットと顔の案を頼みました")).toBeVisible();

  const kit = designOutput.kit;
  const directions = [
    { label: "青の帯", html: thumbnailHtml, rationaleMd: "大阪府の青。帯で 3 段。", kit },
    {
      label: "白い面",
      html: thumbnailHtml.replace("background: #C3ECF6", "background: #F0F0F0"),
      rationaleMd: "公式の Off White。",
      kit: { ...kit, palette: { ...kit.palette, ground: "#F0F0F0" } },
    },
  ];
  const kitRun = await runAssetJob(request, {
    ...designOutput,
    templateId: "connpass-thumbnail",
    html: null,
    kit: null,
    directions,
    skinSource: "brief",
  });
  expect(kitRun.summary.directions).toBe(2);
  expect(kitRun.summary.mustFails).toBe(0);
  expect(
    kitRun.bundle["skills/pr-playbook/examples/design/kits/devfest-kansai-2026.json"],
  ).toBeTruthy();
  expect(kitRun.bundle["JOB.md"]).toContain("directions");

  await page.goto(`/c/${slug}/assets`);
  await expect(page.getByRole("button", { name: "これにする" })).toHaveCount(2);
  await page.getByRole("button", { name: "これにする" }).first().click();
  await expect(page.getByText("この案をキットにしました")).toBeVisible();
  await expect(page.getByRole("button", { name: "キットを作り直す" })).toBeVisible();
  // Adopting also made the usable thumbnail.
  await expect(page.getByRole("link", { name: /connpass のサムネイル（顔） #\d+/ })).toBeVisible();

  // A derivative follows the kit.
  await page.getByRole("combobox", { name: "種類" }).click();
  await page.getByRole("option", { name: "セッション紹介（横）" }).click();
  await page.getByRole("button", { name: "画像を作る" }).click();
  await expect(page.getByText("画像を頼みました")).toBeVisible();
  const card = await runAssetJob(request, { ...designOutput, skinSource: "kit" });
  expect(card.bundle["KIT.json"]).toContain('"dominant"');
  expect(card.bundle["KIT.html"]).toContain("canvas");
  expect(card.summary.mustFails).toBe(0);

  await page.goto(`/c/${slug}/assets/${card.summary.assetId}`);
  await expect(page.getByText("秘書のデザイン")).toBeVisible();
  await expect(page.getByText("MUST はすべて OK")).toBeVisible();
  await expect(page.getByText("秘書の判断")).toBeVisible();
  await page.getByRole("button", { name: "承認して配る" }).click();
  await expect(page.getByText(/img.gdgs.jp に上げました/)).toBeVisible();

  // Asking for a revision queues a job that carries the previous version.
  await page.getByLabel("直してほしいこと").fill("題をもう少し大きく");
  await page.getByRole("button", { name: "直しを頼む" }).click();
  await expect(page.getByText("秘書に直しを頼みました")).toBeVisible();
  const revision = await runAssetJob(request, { ...designOutput, skinSource: "kit" });
  expect(revision.bundle["PREVIOUS.html"]).toContain("canvas");
  expect(revision.bundle["JOB.md"]).toContain("題をもう少し大きく");
  expect(revision.bundleBody.images).toEqual(expect.arrayContaining(["PREVIOUS.png"]));
});

test("live posts are generated from the timetable, in time order, with cards", async ({ page }) => {
  test.setTimeout(120_000);
  const slug = `e2e-live-${Date.now()}`;
  await startWithBrief(page, slug);

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
