import { readFileSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { CAPTURE_URL } from "./capture-server";

// Metrics, ads CSV, flights and the weekly analysis (Stage 07).
const skills = new URL("../../../skills/", import.meta.url);
const brief = readFileSync(
  new URL("pr-playbook/examples/briefs/devfest-kansai-2026.json", skills),
  "utf8",
);
const report = JSON.parse(
  readFileSync(new URL("pr-analyze/references/example-output.json", skills), "utf8"),
);
const runnerToken = () =>
  /^RUNNER_TOKEN="?([^"\n]+)"?/m.exec(
    readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"),
  )?.[1] ?? "";
const headers = () => ({ authorization: `Bearer ${runnerToken()}`, "x-runner-host": "e2e-runner" });
const cron = async (request: APIRequestContext, name: string) =>
  expect((await request.get(`/dev/cron?name=${name}`)).status()).toBe(200);
const jstLocal = (days: number) =>
  new Date(Date.now() + days * 86400_000 + 9 * 3600_000).toISOString().slice(0, 16);
const isoDate = (days: number) =>
  new Date(Date.now() + days * 86400_000 + 9 * 3600_000).toISOString().slice(0, 10);

test("metrics are collected, ads CSVs imported with an overrun alert, and the analysis applied by hand", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const slug = `e2e-met-${Date.now()}`;
  const hook = `metrics-${Date.now()}`;
  await page.goto("/dev/login?as=lead&chapter=1:gdg-kwansai:organizer&return_to=/settings/chapter");
  await page.getByLabel("Discord の webhook URL").fill(`${CAPTURE_URL}/hook/${hook}`);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.goto("/");
  await page.getByRole("button", { name: "キャンペーンを作成" }).first().click();
  await page.getByLabel("イベント名").fill(`E2E ${slug}`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(slug);
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.getByLabel("JSON で読み込む").fill(brief);
  await page.getByRole("button", { name: "JSON を読み込む" }).click();
  await expect(page.getByText("版 1 を保存しました")).toBeVisible();
  await page.goto(`/c/${slug}/settings`);
  await page.getByLabel("connpass グループ").fill("group-1");
  await page.getByLabel("connpass イベント ID").fill("388434");
  await page.getByRole("button", { name: "保存", exact: true }).first().click();
  await expect(page.getByText("設定を更新しました。")).toBeVisible();
  await page.getByRole("button", { name: "有効化" }).click();
  await expect(page.getByText(/有効化しました/)).toBeVisible();

  // Hourly collection → the dashboard.
  await cron(request, "hourly");
  await page.goto(`/c/${slug}/metrics`);
  await expect(page.getByLabel("申込の状況").getByText("312 件")).toBeVisible();
  await expect(
    page.getByRole("table", { name: "チャネル別" }).getByText("X（投稿）"),
  ).toBeVisible();

  // A flight, then an X ads CSV that overruns it: actual written, one alert.
  await page.goto(`/c/${slug}/budget`);
  await page.getByLabel("媒体").fill("x_ads");
  await page.getByLabel("名前").fill("X 告知");
  await page.getByLabel("開始").fill(jstLocal(-3));
  await page.getByLabel("終了").fill(jstLocal(7));
  await page.getByLabel("計画額（円）").fill("10000");
  await page.getByRole("button", { name: "フライトを足す" }).click();
  await expect(page.getByText("追加しました")).toBeVisible();

  const csv = `日付,キャンペーン名,費用,インプレッション,クリック\n${isoDate(-2)},X 告知,"¥6,000",50000,300\n${isoDate(-1)},X 告知,"¥6,000",52000,310\n合計,,"¥12,000",102000,610\n`;
  await page.goto(`/c/${slug}/metrics/import`);
  await page
    .getByLabel("CSV ファイル")
    .setInputFiles({ name: "x.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByRole("button", { name: "取り込む" }).click();
  await expect(
    page.getByText(/2 行を取り込みました（費用 12,000 円、X 告知 の実績に反映）/),
  ).toBeVisible();
  await expect(page.getByText(/予算超過/)).toBeVisible();
  // The same period again replaces, and the alert is not sent twice.
  await page.goto(`/c/${slug}/metrics/import`);
  await page
    .getByLabel("CSV ファイル")
    .setInputFiles({ name: "x.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByRole("button", { name: "取り込む" }).click();
  await expect(page.getByText(/2 行を取り込みました/)).toBeVisible();
  const alerts = (
    (await (await request.get(`${CAPTURE_URL}/messages`)).json()) as {
      hook: string;
      content: string;
    }[]
  ).filter((m) => m.hook === hook && m.content.includes("予算超過"));
  expect(alerts).toHaveLength(1);
  await page.goto(`/c/${slug}/metrics`);
  await expect(page.getByRole("table", { name: "広告" }).getByText("12,000 円")).toBeVisible();

  // The weekly analysis: a report draft whose proposals a person applies.
  await page.getByRole("button", { name: "分析する" }).click();
  await expect(page.getByText(/分析のジョブを積みました/)).toBeVisible();
  const next = await request.get("/api/runner/jobs/next?types=analyze&wait=0", {
    headers: headers(),
  });
  const job = await next.json();
  const files = (
    await (await request.get(`/api/runner/jobs/${job.id}/bundle`, { headers: headers() })).json()
  ).files;
  expect(JSON.parse(files["METRICS.json"]).applications.applications).toBe(312);
  await request.post(`/api/runner/jobs/${job.id}/result`, {
    headers: headers(),
    data: { status: "succeeded", result: { output: report } },
  });
  await page.goto(`/c/${slug}/drafts`);
  await page.getByRole("link", { name: /週次レポート/ }).click();
  await expect(page.getByText("目標曲線との差").first()).toBeVisible();
  await page
    .getByRole("list", { name: "スケジュールの提案" })
    .getByRole("button", { name: "適用" })
    .click();
  await expect(page.getByText("スケジュールに反映しました")).toBeVisible();
  await page.goto(`/c/${slug}/schedule`);
  await expect(page.getByText("学生展示ブースの紹介", { exact: true })).toBeVisible();
});
