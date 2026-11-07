import { readFileSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { CAPTURE_URL } from "./capture-server";
import { createCampaign } from "./helpers";

// The assistant: a person pastes a page and a file, the Worker collects them (text and images),
// the runner answers with a brief and buttons, and the assistant presses the internal ones.
const brief = JSON.parse(
  readFileSync(
    new URL(
      "../../../skills/pr-playbook/examples/briefs/devfest-kansai-2026.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const runnerToken = () =>
  /^RUNNER_TOKEN="?([^"\n]+)"?/m.exec(
    readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"),
  )?.[1] ?? "";
const headers = () => ({ authorization: `Bearer ${runnerToken()}`, "x-runner-host": "e2e-runner" });

type Bundle = {
  files: Record<string, string>;
  binaryFiles?: Record<string, string>;
  images?: string[];
};

async function runAssist(request: APIRequestContext, slug: string, output: (b: Bundle) => unknown) {
  for (let i = 0; i < 20; i++) {
    const next = await request.get("/api/runner/jobs/next?types=assist&wait=0", {
      headers: headers(),
    });
    expect(next.status()).toBe(200);
    const job = await next.json();
    const bundle = (await (
      await request.get(`/api/runner/jobs/${job.id}/bundle`, { headers: headers() })
    ).json()) as Bundle;
    const url = `/api/runner/jobs/${job.id}/result`;
    if (!bundle.files["STATE.json"]?.includes(`"slug": "${slug}"`)) {
      await request.post(url, {
        headers: headers(),
        data: { status: "failed", error: "e2e: other" },
      });
      continue;
    }
    const result = { output: output(bundle), checks: { yomiyasu: { status: "pass" } } };
    const posted = await request.post(url, {
      headers: headers(),
      data: { status: "succeeded", result },
    });
    expect(posted.ok()).toBe(true);
    return bundle;
  }
  throw new Error(`no assist job for ${slug}`);
}

test("the assistant reads a pasted page and its image, rewrites the brief, and starts the plan", async ({
  page,
  request,
}) => {
  const slug = `e2e-ast-${Date.now()}`;
  await page.goto(
    "/dev/login?as=lead&chapter=1:gdg-kwansai:organizer&chapter=4:gdg-kyoto&return_to=/",
  );
  await expect(page.getByRole("heading", { name: "通知", level: 1 })).toBeVisible();
  await createCampaign(page, slug);
  await page.goto(`/c/${slug}`);
  await expect(page.getByText("秘書です。準備を始めましょう。")).toBeVisible();

  await page.getByLabel("秘書へのメッセージ").fill(`イベントページです ${CAPTURE_URL}/event`);
  await page.locator('input[name="files"]').setInputFiles({
    name: "memo.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("申込目標は 150 人"),
  });
  await page.getByRole("button", { name: "送る" }).click();
  await expect(page.getByText("秘書が読んでいます")).toBeVisible();
  await expect(page.getByRole("link", { name: "E2E Meetup" })).toBeVisible();

  const bundle = await runAssist(request, slug, () => ({
    reply: "ページとタイムテーブルの画像を読みました。",
    briefJson: JSON.stringify(brief),
    briefChanges: ["日時と会場を入れた"],
    questions: ["予算はいくらですか？"],
    actions: [
      {
        type: "run_plan",
        label: "計画を作る",
        scheduleItemIds: [],
        dueAt: null,
        path: null,
        instructions: null,
      },
      {
        type: "open_page",
        label: "予定表を見る",
        scheduleItemIds: [],
        dueAt: null,
        path: `/c/${slug}/schedule`,
        instructions: null,
      },
      {
        type: "open_page",
        label: "外へ",
        scheduleItemIds: [],
        dueAt: null,
        path: "https://example.com/",
        instructions: null,
      },
    ],
  }));
  // What the Worker collected: the page's text (contacts masked), its image, and the file.
  const sourceText = Object.entries(bundle.files).find(([p]) => /^sources\/\d+\.txt$/.test(p))?.[1];
  expect(sourceText).toContain("E2E Meetup");
  expect(sourceText).not.toContain("staff@example.com");
  expect(bundle.images?.some((p) => p.startsWith("sources/"))).toBe(true);
  expect(Object.keys(bundle.binaryFiles ?? {})).toEqual(bundle.images);
  expect(Object.values(bundle.files).some((t) => t === "申込目標は 150 人")).toBe(true);
  expect(bundle.files["THREAD.md"]).toContain(`${CAPTURE_URL}/event`);

  await page.reload();
  await expect(page.getByText("ページとタイムテーブルの画像を読みました。")).toBeVisible();
  await expect(page.getByRole("link", { name: "brief を更新しました（版 1）" })).toBeVisible();
  await expect(page.getByText("予算はいくらですか？", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "予定表を見る" })).toBeVisible();
  await expect(page.getByRole("link", { name: "外へ" })).toHaveCount(0);
  // The assistant offered the plan and pressed it itself (chapter default: auto).
  await expect(page.getByText("計画を作る: 計画を作り始めました")).toBeVisible();

  await page.goto("/");
  const mine = page.locator(`a[href="/c/${slug}"]`);
  await expect(mine.filter({ hasText: "秘書から質問: 予算はいくらですか？" })).toBeVisible();
  await expect(mine.filter({ hasText: "計画を作っています" })).toBeVisible();

  // The sidebar's chapter decides what every list shows.
  await page.getByRole("button", { name: "チャプターを切り替える" }).click();
  await page.getByRole("menuitem", { name: "GDG Kyoto" }).click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByText("イベントがありません")).toBeVisible();
});
