import { readFile } from "node:fs/promises";
import { type Browser, type Page, expect, test } from "@playwright/test";

const SPIN_TIMEOUT = 15_000;

async function signIn(page: Page, chapter = "1:dev-chapter") {
  await page.goto(`/dev/login?as=owner&chapter=${chapter}&return_to=/`);
  await expect(page.getByRole("heading", { name: "プロジェクト", level: 1 })).toBeVisible();
}

async function createProject(page: Page, slug: string) {
  await page.getByRole("button", { name: "プロジェクトを作成" }).first().click();
  await page.getByLabel("プロジェクト名").fill(`E2E 抽選 ${slug}`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(slug);
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${slug}$`));
  await expect(page.getByText("景品を登録して、受付を始めましょう")).toBeVisible();
}

async function spinAsVisitor(browser: Browser, slug: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`/${slug}`);
  await page.getByRole("button", { name: "ルーレットを回す" }).click();
  return { context, page };
}

test("an organizer sets up prizes and visitors win them one spin per device", async ({
  page,
  browser,
}) => {
  const slug = `e2e-${Date.now()}`;
  await signIn(page);
  await createProject(page, slug);

  // One jackpot at 100%; once it is gone only the losing slot is left.
  await page.getByRole("radio", { name: "カスタムモード" }).click();
  await page.getByRole("button", { name: "景品を追加" }).click();
  await page.getByLabel("景品名（1 行目）").fill("Google Pixel 10");
  await page.getByLabel("確率（1 行目）").fill("100");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(page.getByText("確率の合計を 100% にしてください（今は 200%）")).toBeVisible();
  await page.getByLabel("確率（2 行目）").fill("0");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(page.getByText("変更を保存しました")).toBeVisible();

  // Closed until the organizer opens it.
  const early = await browser.newPage();
  await early.goto(`/${slug}`);
  await expect(early.getByText("いまは抽選を受け付けていません")).toBeVisible();
  await expect(early.getByRole("button", { name: "ルーレットを回す" })).toBeDisabled();
  await early.close();

  await page.getByRole("switch", { name: "抽選を受け付ける" }).click();
  await expect(page.getByText("抽選の受付を始めました")).toBeVisible();

  const first = await spinAsVisitor(browser, slug);
  await expect(first.page.getByText("大当たり！")).toBeVisible({ timeout: SPIN_TIMEOUT });
  await expect(
    first.page.getByRole("heading", { name: "Google Pixel 10", level: 2 }),
  ).toBeVisible();
  await expect(first.page.getByText("No. 001")).toBeVisible();
  // Visitors see what can be won, never how many are left.
  await expect(first.page.getByText("1 等 · Google Pixel 10")).toBeVisible();
  await expect(first.page.getByText(/残り/)).toHaveCount(0);

  await first.page.reload();
  await expect(first.page.getByText("この端末ではもう抽選しました")).toBeVisible();
  await expect(first.page.getByRole("button", { name: "ルーレットを回す" })).toHaveCount(0);
  await first.context.close();

  const second = await spinAsVisitor(browser, slug);
  await expect(second.page.getByText("ざんねん…")).toBeVisible({ timeout: SPIN_TIMEOUT });
  await expect(second.page.getByRole("heading", { name: "ハズレ", level: 2 })).toBeVisible();
  await second.context.close();

  await page.reload();
  await expect(page.getByText("2 回", { exact: true })).toBeVisible();
  await expect(page.getByText("0 個", { exact: true })).toBeVisible();

  // The log lists every spin, latest first, and downloads as CSV.
  const log = page.getByRole("table", { name: "抽選ログ" });
  await expect(log.getByRole("row").nth(1)).toContainText("No. 002");
  await expect(log.getByRole("row").nth(1)).toContainText("ハズレ");
  await expect(log.getByRole("row").nth(2)).toContainText("No. 001");
  await expect(log.getByRole("row").nth(2)).toContainText("1 等Google Pixel 10");
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "CSV をダウンロード" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`${slug}-draws.csv`);
  const csv = await readFile(await download.path(), "utf8");
  expect(csv).toMatch(
    /^\uFEFF"No.","日時","等級","景品"\r\n"1","[\d-]+ [\d:]+","1 等","Google Pixel 10"\r\n"2",/,
  );

  // Reset clears the counters and lets devices spin again.
  await page.getByRole("button", { name: "その他の操作" }).click();
  await page.getByRole("menuitem", { name: "抽選結果をリセット" }).click();
  await page.getByRole("button", { name: "リセットする" }).click();
  await expect(page.getByText("抽選結果をリセットしました")).toBeVisible();
  await expect(page.getByText("0 回", { exact: true })).toBeVisible();
  await expect(log.getByText("まだ抽選されていません")).toBeVisible();
});

test("the evil mode shows an excluded prize but never draws it", async ({ page, browser }) => {
  const slug = `e2e-evil-${Date.now()}`;
  await signIn(page);
  await createProject(page, slug);

  await page.getByRole("button", { name: "景品を追加" }).click();
  await page.getByLabel("景品名（1 行目）").fill("Google Pixel 10");
  await page.getByRole("radio", { name: "悪徳モード" }).click();
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(
    page.getByText("悪徳モードでは、出さない景品を 1 つ以上選んでください"),
  ).toBeVisible();
  await page.getByLabel("出さない（1 行目）").check();
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(page.getByText("変更を保存しました")).toBeVisible();
  await page.getByRole("switch", { name: "抽選を受け付ける" }).click();
  await expect(page.getByText("抽選の受付を始めました")).toBeVisible();

  // The Pixel is the only prize with stock, yet the losing slot comes out.
  const visitor = await spinAsVisitor(browser, slug);
  await expect(visitor.page.getByText("1 等 · Google Pixel 10")).toBeVisible();
  await expect(visitor.page.getByText("ざんねん…")).toBeVisible({ timeout: SPIN_TIMEOUT });
  await visitor.context.close();

  // Reloading keeps the mode, derived from the excluded prize.
  await page.reload();
  await expect(page.getByRole("radio", { name: "悪徳モード" })).toBeChecked();
  await expect(page.getByLabel("出さない（1 行目）")).toBeChecked();
});

test("admin pages need a member of the owning chapter", async ({ page, browser }) => {
  const slug = `e2e-gate-${Date.now()}`;
  await signIn(page);
  await createProject(page, slug);

  const anonymous = await browser.newContext();
  const response = await anonymous.request.get(`/admin/${slug}`, { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toContain(`/signin?return_to=%2Fadmin%2F${slug}`);
  await anonymous.close();

  const outsider = await browser.newPage();
  await outsider.goto(`/dev/login?as=outsider&chapter=2:other-chapter&return_to=/admin/${slug}`);
  await expect(outsider.getByText("アクセスできません")).toBeVisible();
  await outsider.close();
});
