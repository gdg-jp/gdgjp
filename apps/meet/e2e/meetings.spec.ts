import { expect, test } from "@playwright/test";

test("チャプター所属ユーザーは / と /meetings/new を開け、Google 未接続の警告が表示される", async ({
  page,
}) => {
  await page.goto("/dev/login?as=organizer1&chapter=1:tokyo:organizer&return_to=/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "GDG Japan Meet", level: 1 })).toBeVisible();
  await expect(page.getByText("共有 Google アカウントが未接続です")).toBeVisible();
  await expect(page.getByRole("link", { name: "新しい会議" })).toBeVisible();

  await page.getByRole("link", { name: "新しい会議" }).click();
  await expect(page).toHaveURL(/\/meetings\/new$/);
  await expect(page.getByRole("heading", { name: "新しい会議を作成", level: 1 })).toBeVisible();
  await expect(page.getByText("共有 Google アカウントが未接続です")).toBeVisible();
  await expect(page.getByLabel("会議タイトル")).toBeVisible();
  await expect(page.getByRole("button", { name: "会議を作成" })).toBeDisabled();
});

test("チャプター未所属ユーザーには新しい会議ボタンが出ず、/meetings/new は /no-chapter へリダイレクトされる", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/dev/login?as=guest1&chapter=none&return_to=/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "新しい会議" })).toHaveCount(0);

  await page.goto("/meetings/new");
  await expect(page).toHaveURL(/\/no-chapter$/);
  await context.close();
});
