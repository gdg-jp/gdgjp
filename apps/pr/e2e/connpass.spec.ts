import { readFileSync } from "node:fs";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";

// connpass (Stage 04) against e2e/mock-services/connpass.ts.
const skills = new URL("../../../skills/", import.meta.url);
const brief = readFileSync(
  new URL("pr-playbook/examples/briefs/devfest-kansai-2026.json", skills),
  "utf8",
);
const pageOutput = JSON.parse(
  readFileSync(new URL("pr-connpass-page/references/example-output.json", skills), "utf8"),
);
const mailOutput = JSON.parse(
  readFileSync(new URL("pr-connpass-mail/references/example-output.json", skills), "utf8"),
);

const runnerToken = () =>
  /^RUNNER_TOKEN="?([^"\n]+)"?/m.exec(
    readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"),
  )?.[1] ?? "";
const headers = () => ({ authorization: `Bearer ${runnerToken()}`, "x-runner-host": "e2e-runner" });

type Job = {
  id: string;
  type: string;
  status: string;
  groupId: string;
  request: Record<string, unknown>;
};
const connpassJobs = async (request: APIRequestContext): Promise<Job[]> =>
  (await (await request.get("/dev/mock-services")).json()).connpass.jobs;
const cron = async (request: APIRequestContext, name: "minute" | "hourly") =>
  expect((await request.get(`/dev/cron?name=${name}`)).status()).toBe(200);

async function runPageJob(request: APIRequestContext, output: unknown) {
  const next = await request.get("/api/runner/jobs/next?types=page&wait=0", { headers: headers() });
  expect(next.status()).toBe(200);
  const job = await next.json();
  const bundle = await (
    await request.get(`/api/runner/jobs/${job.id}/bundle`, { headers: headers() })
  ).json();
  const result = await request.post(`/api/runner/jobs/${job.id}/result`, {
    headers: headers(),
    data: { status: "succeeded", result: { output, checks: { yomiyasu: { status: "pass" } } } },
  });
  expect(result.status()).toBe(200);
  return bundle.files as Record<string, string>;
}

function jstLocal(minutes: number) {
  return new Date(Date.now() + minutes * 60_000 + 9 * 3600_000).toISOString().slice(0, 16);
}

async function setUp(page: Page, slug: string) {
  await page.goto("/dev/login?as=lead&chapter=1:gdg-kwansai:organizer&return_to=/");
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
}

test("a connpass page is rendered from slots, previewed, and sent on approval", async ({
  page,
  request,
}) => {
  const slug = `e2e-cp-${Date.now()}`;
  await setUp(page, slug);
  await page.goto(`/c/${slug}/plan`);
  await page.getByRole("button", { name: "connpass ページを作る" }).click();
  await expect(page.getByText("connpass ページのジョブを積みました")).toBeVisible();
  const files = await runPageJob(request, pageOutput);
  expect(Object.keys(files)).toEqual(
    expect.arrayContaining([
      "skills/pr-connpass-page/SKILL.md",
      "skills/pr-playbook/templates/connpass-page/sections/overview.html",
      "skills/pr-playbook/scripts/render/connpass-page.mjs",
      "IMAGES.json",
    ]),
  );

  await page.goto(`/c/${slug}/drafts`);
  await page.getByRole("link", { name: "connpass ページ" }).click();
  await page.waitForURL(/\/drafts\/\d+$/);
  const frame = page.frameLocator('iframe[title="connpass のプレビュー"]');
  await expect(frame.getByText("開催概要")).toBeVisible();
  await page.getByRole("button", { name: "390 px" }).click();

  // An image slot filled from the page makes a new version with the image in the HTML.
  await page.getByLabel(/タイムテーブル（timetable-image）/).fill("https://img.gdgs.jp/timetable");
  await page.getByRole("button", { name: "画像を入れて新しい版にする" }).click();
  await expect(page.getByText(/版 2 を保存しました/)).toBeVisible();
  await expect(frame.locator('img[src="https://img.gdgs.jp/timetable"]')).toBeVisible();

  await page.getByRole("button", { name: "承認", exact: true }).click();
  await expect(page.getByText(/connpass に反映するジョブを積みました/)).toBeVisible();
  const update = (await connpassJobs(request)).filter((j) => j.type === "update_event").at(-1);
  expect(update?.groupId).toBe("group-1");
  const description = String(update?.request.description ?? "");
  expect(description).toContain("開催概要");
  expect(description).toContain("https://img.gdgs.jp/timetable");
  expect(description).not.toContain("border-radius");

  // The job finishes on connpass → the hourly cron marks the connpass_update item done.
  await request.post("/dev/mock-services", { form: { finish: update?.id ?? "" } });
  await cron(request, "hourly");
  await page.goto(`/c/${slug}/settings`);
  await expect(
    page.getByRole("list", { name: "connpass のジョブ" }).getByText("succeeded").first(),
  ).toBeVisible();

  // Over 1 MB is refused before anything is sent.
  await page.getByLabel("サムネイル").setInputFiles({
    name: "big.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(1024 * 1024 + 1),
  });
  await page.getByRole("button", { name: "上げる" }).click();
  await expect(page.getByText("connpass の画像は 1 MB までです")).toBeVisible();

  // A sub-event draft on connpass.
  await page.goto(`/c/${slug}/plan`);
  await page.getByLabel("サブイベントを作る").fill("学生エンジニア座談会");
  await page.getByRole("button", { name: "作る", exact: true }).click();
  await expect(page.getByText(/サブイベントを作るジョブを積みました/)).toBeVisible();
  expect(
    (await connpassJobs(request)).some(
      (j) => j.type === "create_sub_event" && j.request.title === "学生エンジニア座談会",
    ),
  ).toBe(true);
});

test("an approved connpass mail waits for its time, then goes out once", async ({
  page,
  request,
}) => {
  const slug = `e2e-mail-${Date.now()}`;
  await setUp(page, slug);
  const settings = `/c/${slug}/settings`;
  await page.goto(settings);
  await page.getByRole("button", { name: "有効化" }).click();
  await expect(page.getByText(/有効化しました/)).toBeVisible();
  await page.request.post(settings, {
    form: { intent: "add-handle", kind: "connpass_group", handle: "group-1", chapter: "1" },
  });
  const schedule = `/c/${slug}/schedule`;
  await page.request.post(schedule, {
    form: {
      intent: "create",
      kind: "connpass_mail",
      dueAt: jstLocal(120),
      title: "前日リマインド",
    },
  });
  await page.goto(schedule);
  await page.getByLabel("「前日リマインド」の下書きを作る").check();
  await page.getByRole("button", { name: "選んだ投稿の下書きを runner に頼む" }).click();
  await expect(page.getByText(/件の下書きを runner に頼みました/)).toBeVisible();
  await runPageJob(request, mailOutput);

  await page.goto(`/c/${slug}/drafts`);
  await page.getByRole("link", { name: "前日リマインド" }).click();
  await page.waitForURL(/\/drafts\/\d+$/);
  await page.getByRole("button", { name: "承認", exact: true }).click();
  await expect(page.getByText("承認済み", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "group-1 で予約" }).click();
  await expect(page.getByText(/予定の時刻に送ります/)).toBeVisible();

  const before = (await connpassJobs(request)).filter(
    (j) => j.type === "send_event_message",
  ).length;
  await cron(request, "minute");
  expect((await connpassJobs(request)).filter((j) => j.type === "send_event_message")).toHaveLength(
    before,
  );

  // Its time comes: one message, once.
  await page.goto(schedule);
  const itemId = await page
    .locator("li[data-item-id]")
    .filter({ hasText: "前日リマインド" })
    .getAttribute("data-item-id");
  await page.request.post(schedule, {
    form: {
      intent: "update",
      id: String(itemId),
      kind: "connpass_mail",
      dueAt: jstLocal(-1),
      title: "前日リマインド",
      status: "approved",
    },
  });
  await cron(request, "minute");
  await cron(request, "minute");
  const sent = (await connpassJobs(request)).filter((j) => j.type === "send_event_message");
  expect(sent).toHaveLength(before + 1);
  expect(sent.at(-1)?.request.subject).toBe(mailOutput.subject);
});
