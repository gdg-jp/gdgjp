import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const require = createRequire(import.meta.url);
const wranglerPkgPath = require.resolve("wrangler/package.json");
const wranglerPkg = require(wranglerPkgPath) as { bin: string | { wrangler: string } };
const wranglerBin =
  typeof wranglerPkg.bin === "string" ? wranglerPkg.bin : wranglerPkg.bin.wrangler;
const wranglerEntrypoint = resolve(dirname(wranglerPkgPath), wranglerBin);

function runLocalD1(sql: string) {
  const persistArgs = process.env.WIKI_E2E_PERSIST_TO
    ? ["--persist-to", process.env.WIKI_E2E_PERSIST_TO]
    : [];
  execFileSync(
    process.execPath,
    [
      wranglerEntrypoint,
      "d1",
      "execute",
      "gdgjp-meet-db",
      "--local",
      ...persistArgs,
      "--command",
      sql,
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: "pipe",
    },
  );
}

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

test("会議詳細画面で招待者の Google アカウント画像を表示し、未登録・読込失敗時は人アイコンへフォールバックする", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/dev/login?as=avatarviewer&chapter=1:tokyo:organizer&return_to=/");
  await expect(page).toHaveURL(/\/$/);

  try {
    runLocalD1(`
      UPDATE "user"
      SET image = 'https://lh3.googleusercontent.com/a/e2e-avatar-ok=s96-c'
      WHERE id = 'dev-user-avatarviewer';

      INSERT OR REPLACE INTO "user" (id, email, name, image)
      VALUES (
        'e2e-broken-user',
        'broken@example.com',
        'Broken Avatar',
        'https://lh3.googleusercontent.com/a/e2e-avatar-broken=s96-c'
      );

      DELETE FROM meetings WHERE id = 'e2e-avatar-meeting';

      INSERT INTO meetings (
        id, host_chapter_id, title, description, start_at, end_at, time_zone,
        access_type, status, created_by_user_id, created_by_email, created_at, updated_at
      ) VALUES (
        'e2e-avatar-meeting', 1, 'アバター検証会議', '',
        '2026-12-01T10:00:00.000Z', '2026-12-01T11:00:00.000Z', 'Asia/Tokyo',
        'RESTRICTED', 'active', 'dev-user-avatarviewer', 'avatarviewer@dev.local',
        '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'
      );

      INSERT INTO meeting_invitees (
        meeting_id, email_normalized, email, display_name, user_id, role, source_kinds
      ) VALUES
        (
          'e2e-avatar-meeting', 'avatarviewer@dev.local', 'avatarviewer@dev.local',
          'Avatar Viewer', 'dev-user-avatarviewer', 'cohost', '["creator"]'
        ),
        (
          'e2e-avatar-meeting', 'broken@example.com', 'broken@example.com',
          'Broken Avatar', 'e2e-broken-user', 'participant', '["email"]'
        ),
        (
          'e2e-avatar-meeting', 'external@example.com', 'external@example.com',
          NULL, NULL, 'participant', '["email"]'
        );
    `);

    const avatarRequests: Array<{ url: string; referer: string | undefined }> = [];
    await page.route("https://lh3.googleusercontent.com/**", async (route) => {
      const req = route.request();
      const url = req.url();
      avatarRequests.push({ url, referer: req.headers().referer });
      if (url.includes("e2e-avatar-ok")) {
        await route.fulfill({
          status: 200,
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#4285F4"/></svg>',
        });
        return;
      }
      await route.fulfill({ status: 404, body: "Not Found" });
    });

    const response = await page.goto("/meetings/e2e-avatar-meeting");
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(page.getByRole("heading", { name: "アバター検証会議", level: 1 })).toBeVisible();

    const okAvatar = page.locator('img[alt="Avatar Viewer"]');
    await expect(okAvatar).toBeVisible();
    await expect(okAvatar).toHaveAttribute(
      "src",
      "https://lh3.googleusercontent.com/a/e2e-avatar-ok=s96-c",
    );
    await expect
      .poll(() =>
        okAvatar.evaluate((el) => {
          const img = el as HTMLImageElement;
          return img.complete && img.naturalWidth > 0;
        }),
      )
      .toBe(true);

    const brokenFallback = page.locator('[role="img"][aria-label="Broken Avatar"] svg');
    await expect(brokenFallback).toBeVisible();
    await expect(page.locator('img[alt="Broken Avatar"]')).toHaveCount(0);

    const externalFallback = page.locator('[role="img"][aria-label="external@example.com"] svg');
    await expect(externalFallback).toBeVisible();

    await expect.poll(() => avatarRequests.some((r) => r.url.includes("e2e-avatar-ok"))).toBe(true);
    await expect
      .poll(() => avatarRequests.some((r) => r.url.includes("e2e-avatar-broken")))
      .toBe(true);
    for (const req of avatarRequests) {
      expect(req.referer).toBeUndefined();
    }

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await page.getByRole("button", { name: "テーマを切り替える" }).click();
    await page.getByRole("menuitemradio", { name: "ダーク" }).click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(okAvatar).toBeVisible();
    await expect(brokenFallback).toBeVisible();
    await expect(externalFallback).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  } finally {
    runLocalD1(`
      DELETE FROM meetings WHERE id = 'e2e-avatar-meeting';
      DELETE FROM "user" WHERE id = 'e2e-broken-user';
      UPDATE "user" SET image = NULL WHERE id = 'dev-user-avatarviewer';
    `);
    await context.close();
  }
});
