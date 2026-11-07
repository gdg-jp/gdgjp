import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";
import { createCampaign } from "./helpers";

const brief = readFileSync(
  new URL("../../../skills/pr-playbook/examples/briefs/devfest-kansai-2026.json", import.meta.url),
  "utf8",
);

async function signIn(page: Page, as: string, chapter: string) {
  await page.goto(`/dev/login?as=${as}&chapter=${chapter}&return_to=/`);
  await expect(page.getByRole("heading", { name: "通知", level: 1 })).toBeVisible();
}

test("a lead creates a campaign, loads a brief, and schedules a post with derived reminders", async ({
  page,
}) => {
  const slug = `e2e-${Date.now()}`;
  await signIn(page, "lead", "1:gdg-kwansai:organizer");
  await createCampaign(page, slug);

  await page.getByLabel("JSON で読み込む").fill(brief);
  await page.getByRole("button", { name: "JSON を読み込む" }).click();
  await expect(page.getByText("版 1 を保存しました")).toBeVisible();
  await expect(page.getByLabel("イベントのハッシュタグ")).toHaveValue("#DevFestKansai");

  // The rendered form saves back to a valid brief (selects, tables, datetimes).
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("版 2 を保存しました")).toBeVisible();

  await page.getByRole("link", { name: "予定表" }).click();
  await page.getByRole("button", { name: "アイテムを追加" }).click();
  await page.getByLabel("日時").fill("2026-10-07T18:00");
  await page.getByLabel("タイトル").fill("セッション紹介");
  await page.getByLabel("告知開始の条件").fill("session:never-confirmed:confirmed");
  await page.getByRole("button", { name: "追加", exact: true }).click();

  const rows = page.locator("li[data-item-id]");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("18:00");
  await expect(rows.nth(0)).toContainText("待ち: セッション「never-confirmed」の確定");
  await expect(rows.nth(1)).toContainText("17:00");
  await expect(rows.nth(1)).toContainText("スタッフへいいね・リポストの依頼");

  // Moving the post moves its reminder by the same offset.
  await rows.nth(0).getByRole("button", { name: "編集" }).click();
  await page.getByLabel("日時").fill("2026-10-07T19:00");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(rows.nth(1)).toContainText("18:00");
});

test("co-host chapters see the campaign but cannot edit the brief; others get 404", async ({
  page,
}) => {
  const slug = `e2e-co-${Date.now()}`;
  await signIn(page, "host", "1:gdg-kwansai:organizer");
  await createCampaign(page, slug);
  await page.goto(`/c/${slug}/members`);
  await page.getByLabel("チャプター ID").fill("2");
  await page.getByLabel("チャプター名").fill("gdgoc-osaka");
  await page.getByRole("button", { name: "共催に追加" }).click();
  await expect(page.getByText("gdgoc-osaka（ID 2）")).toBeVisible();

  await signIn(page, "cohost", "2:gdgoc-osaka:organizer");
  await page.goto("/events");
  await expect(page.getByRole("link", { name: slug })).toBeVisible();
  await page.goto(`/c/${slug}/brief`);
  await expect(page.getByText("閲覧のみ")).toBeVisible();

  await signIn(page, "outsider", "3:other");
  const response = await page.goto(`/c/${slug}`);
  expect(response?.status()).toBe(404);
});
