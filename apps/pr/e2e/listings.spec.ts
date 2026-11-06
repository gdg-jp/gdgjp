import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

// Listings (Stage 05): mapped from the brief, approved, then through the connpass app or by hand.
const brief = readFileSync(
  new URL("../../../skills/pr-playbook/examples/briefs/devfest-kansai-2026.json", import.meta.url),
  "utf8",
);
const jstLocal = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000 + 9 * 3600_000).toISOString().slice(0, 16);

async function approveListing(page: Page, slug: string, title: string) {
  await page.goto(`/c/${slug}/drafts`);
  await page.getByRole("link", { name: title, exact: true }).click();
  await page.waitForURL(/\/drafts\/\d+$/);
  await page.getByRole("button", { name: "承認", exact: true }).click();
}

test("listings are mapped from the brief; Findy goes once; Luma goes through the connpass app", async ({
  page,
  request,
}) => {
  const slug = `e2e-lst-${Date.now()}`;
  await page.goto("/dev/login?as=lead&chapter=1:gdg-kwansai:organizer&return_to=/");
  await page.getByRole("button", { name: "キャンペーンを作成" }).first().click();
  await page.getByLabel("イベント名").fill(`E2E ${slug}`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(slug);
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.getByLabel("JSON で読み込む").fill(brief);
  await page.getByRole("button", { name: "JSON を読み込む" }).click();
  await expect(page.getByText("版 1 を保存しました")).toBeVisible();

  await page.goto(`/c/${slug}/settings`);
  await page.getByLabel("Luma カレンダー ID").fill("cal-123");
  await page.getByRole("button", { name: "掲載先を保存" }).click();
  await expect(page.getByText("掲載先を保存しました")).toBeVisible();

  const schedule = `/c/${slug}/schedule`;
  for (const [kind, title] of [
    ["findy_submit", "Findy 申請"],
    ["findy_submit", "Findy 申請（2 回目）"],
    ["luma_publish", "Luma 掲載"],
  ])
    await page.request.post(schedule, {
      form: { intent: "create", kind, dueAt: jstLocal(600), title },
    });
  await page.goto(schedule);
  for (const title of ["Findy 申請", "Findy 申請（2 回目）", "Luma 掲載"])
    await page.getByLabel(`「${title}」の下書きを作る`).check();
  await page.getByRole("button", { name: "選んだ投稿の下書きを runner に頼む" }).click();
  await expect(page.getByText(/掲載文 3 件/)).toBeVisible();

  // Findy: no automation yet → the text to paste, then "listed by hand".
  await approveListing(page, slug, "Findy 申請");
  await expect(page.getByText(/手で掲載し「手で掲載した」を押してください/)).toBeVisible();
  await expect(page.getByText("Findy Conference の掲載内容")).toBeVisible();
  await expect(page.getByText(/DevFest/).first()).toBeVisible();
  await page.getByLabel("掲載した URL").fill("https://conference.findy-code.io/conferences/x");
  await page.getByRole("button", { name: "手で掲載した" }).click();
  await expect(page.getByText("掲載済みにしました")).toBeVisible();

  // A second Findy submission in the same campaign is refused.
  await approveListing(page, slug, "Findy 申請（2 回目）");
  await expect(page.getByText(/もう送っています/)).toBeVisible();

  // Luma with a target: a create_listing job on the connpass app.
  await approveListing(page, slug, "Luma 掲載");
  await expect(page.getByText(/掲載のジョブを積みました/)).toBeVisible();
  const jobs = (await (await request.get("/dev/mock-services")).json()).connpass.jobs as {
    type: string;
    request: { title?: string };
  }[];
  expect(jobs.some((j) => j.type === "create_listing" && j.request.title)).toBe(true);
});
