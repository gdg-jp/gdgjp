import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test.beforeAll(() => {
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "migrations", "apply", "gdgjp-pay-db", "--local"],
    {
      stdio: "pipe",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
});

test("a signed-in account without a chapter is told why and what to do", async ({ page }) => {
  const response = await page.goto("/dev/login?as=nochapter&chapter=0:none:member&return_to=/");
  expect(response?.status()).toBe(403);
  await expect(
    page.getByRole("heading", { level: 1, name: "GDG チャプターへの参加が必要です" }),
  ).toBeVisible();
  await expect(
    page.getByText("サインイン中のアカウントはどのチャプターにも所属していません。", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "別のアカウントでサインイン" })).toHaveAttribute(
    "href",
    "/auth/signout",
  );
  await expect(page).toHaveTitle("GDG チャプターへの参加が必要です — GDG Japan Pay");

  expect((await page.goto("/profile"))?.status()).toBe(403);
  await expect(
    page.getByRole("heading", { level: 1, name: "GDG チャプターへの参加が必要です" }),
  ).toBeVisible();
});

test("a plain member opening the proxy form is told who may register claims for others", async ({
  page,
}) => {
  await page.goto("/dev/login?as=errors-lead&chapter=41:gdg-errors:organizer&return_to=/");
  await page.goto("/events/new");
  await page.getByLabel("イベント名").fill(`Errors ${Date.now().toString(36)}`);
  await page.getByRole("button", { name: "作成する" }).click();
  await page.waitForURL((url) => /^\/events\/(?!new$)[^/]+$/.test(url.pathname));
  const eventPath = new URL(page.url()).pathname;

  await page.goto("/dev/login?as=errors-member&chapter=41:gdg-errors:member&return_to=/");
  const response = await page.goto(`${eventPath}/claims/proxy`);
  expect(response?.status()).toBe(403);
  await expect(
    page.getByRole("heading", { level: 1, name: "このイベントの代行登録はできません" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "代行登録は、イベントを登録した人と、イベントのチャプターのオーガナイザーだけが行えます。",
      { exact: false },
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "イベントに戻る" }).click();
  await page.waitForURL((url) => url.pathname === eventPath);
  await expect(page.getByRole("heading", { name: "自分の申請" })).toBeVisible();
});

test("an unknown event explains that it was not found", async ({ page }) => {
  await page.goto("/dev/login?as=errors-member&chapter=41:gdg-errors:member&return_to=/");
  const response = await page.goto("/events/evt_0000000000000000000000ZZZZ");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "ページが見つかりません" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "イベント一覧へ" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("region", { name: "イベント一覧" }).first()).toBeVisible();
});
