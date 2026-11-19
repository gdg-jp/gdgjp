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

test("/meetings/new の自動記録設定は文字起こし・Gemini Notes が既定オン、録画が既定オフで切り替えられる", async ({
  page,
}) => {
  await page.goto("/dev/login?as=organizer1&chapter=1:tokyo:organizer&return_to=/meetings/new");
  await expect(page).toHaveURL(/\/meetings\/new$/);

  const transcription = page.getByRole("checkbox", { name: "文字起こし（自動開始）" });
  const smartNotes = page.getByRole("checkbox", { name: "Gemini Notes（自動開始）" });
  const recording = page.getByRole("checkbox", { name: "録画・チャット保存（自動開始）" });

  await expect(transcription).toBeChecked();
  await expect(smartNotes).toBeChecked();
  await expect(recording).not.toBeChecked();

  await transcription.click();
  await recording.click();

  await expect(transcription).not.toBeChecked();
  await expect(smartNotes).toBeChecked();
  await expect(recording).toBeChecked();
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

test("公式 Google Workspace ロゴ資産が配信され、ナビゲーションと Google 接続画面に表示される", async ({
  browser,
  request,
}) => {
  const iconPaths = [
    "/favicon.svg",
    "/icons/google-meet.svg",
    "/icons/google-docs.svg",
    "/icons/google-drive-video.svg",
    "/icons/google-logo.svg",
    "/icons/google-calendar.svg",
  ];
  for (const path of iconPaths) {
    const res = await request.get(path);
    expect(res.status(), `${path} status`).toBe(200);
    expect(res.headers()["content-type"], `${path} content-type`).toMatch(/image\/svg\+xml/);
  }

  const adminContext = await browser.newContext();
  const page = await adminContext.newPage();

  await page.goto("/dev/login?as=admin1&chapter=1:tokyo:organizer&admin=1&return_to=/");
  await expect(page).toHaveURL(/\/$/);
  const brandLogo = page
    .getByRole("link", { name: "GDG Japan Meet" })
    .locator('img[src="/icons/google-meet.svg"]');
  await expect(brandLogo).toBeVisible();
  expect(
    await brandLogo.evaluate((el) => {
      const img = el as HTMLImageElement;
      return img.complete && img.naturalWidth > 0;
    }),
  ).toBe(true);

  await page.goto("/admin/google");
  await expect(page).toHaveURL(/\/admin\/google$/);
  const connectButton = page.getByRole("button", {
    name: /Google アカウントを(接続|再接続)/,
  });
  await expect(connectButton).toBeVisible();
  const googleLogo = connectButton.locator('img[src="/icons/google-logo.svg"]');
  await expect(googleLogo).toBeVisible();
  expect(
    await googleLogo.evaluate((el) => {
      const img = el as HTMLImageElement;
      return img.complete && img.naturalWidth > 0;
    }),
  ).toBe(true);

  await adminContext.close();
});
