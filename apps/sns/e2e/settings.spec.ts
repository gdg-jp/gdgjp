import { type Page, expect, test } from "@playwright/test";
import { organizerLogin, queryLocalD1, seedXAccount } from "./local-d1";

async function hydratedContributorSearch(page: Page) {
  const search = page.getByPlaceholder("名前またはメールアドレスで検索");
  const opened = page.waitForResponse(
    (response) =>
      response.url().includes("contributor-candidates") &&
      new URL(response.url()).searchParams.get("q") === "",
  );
  await search.click();
  await opened;
  return search;
}

for (const [chapterId, submit] of [
  [21, "click"],
  [22, "Enter"],
] as const) {
  test(`revoking an X account after the ID check submits on ${submit}`, async ({ page }) => {
    const account = {
      id: `xacc-e2e-revoke-${chapterId}`,
      chapterId,
      xUserId: `91000000000000${chapterId}`,
      username: `e2e_revoke_${chapterId}`,
    };
    seedXAccount(account);
    seedXAccount({
      id: `xacc-e2e-keep-${chapterId}`,
      chapterId,
      xUserId: `92000000000000${chapterId}`,
      username: `e2e_keep_${chapterId}`,
    });

    await page.goto(organizerLogin(`sns-e2e-revoke-${chapterId}`, chapterId, "/settings"));
    await hydratedContributorSearch(page);
    await page
      .getByText(`@${account.username}`, { exact: true })
      .locator("..")
      .getByRole("button", { name: "解除" })
      .click();
    const dialog = page.getByRole("alertdialog", { name: "Xアカウントの認可を解除しますか？" });
    await expect(dialog).toContainText(account.xUserId);
    const confirm = dialog.getByRole("button", { name: "削除する" });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("textbox", { name: "X Account ID" }).fill(account.xUserId);
    await expect(confirm).toBeEnabled();

    const revoked = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().includes("/settings/x"),
    );
    if (submit === "click") await confirm.click();
    else await dialog.getByRole("textbox", { name: "X Account ID" }).press("Enter");
    expect((await revoked).status()).toBeLessThan(400);

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByText(`@${account.username}`)).toHaveCount(0);
    await expect(page.getByText(`@e2e_keep_${chapterId}`)).toBeVisible();
    expect(
      queryLocalD1<{ id: string; revoked: number }>(
        `SELECT id, revoked_at IS NOT NULL AS revoked FROM x_accounts WHERE chapter_id = ${chapterId} ORDER BY id`,
      ),
    ).toEqual([
      { id: `xacc-e2e-keep-${chapterId}`, revoked: 0 },
      { id: account.id, revoked: 1 },
    ]);
  });
}

test("contributor search without an Accounts token explains itself and keeps Settings", async ({
  page,
}) => {
  await page.goto(organizerLogin("sns-e2e-contributors", 23, "/settings"));
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  const search = page.waitForResponse(
    (response) =>
      response.url().includes("contributor-candidates") &&
      new URL(response.url()).searchParams.get("q") === "member@example.com",
  );
  await (await hydratedContributorSearch(page)).fill("member@example.com");
  expect((await search).status()).toBe(401);

  await expect(
    page.getByText("ユーザー検索を使うには、もう一度サインインしてください。", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  const direct = await page.request.get("/api/contributor-candidates?q=member");
  expect(direct.status()).toBe(401);
  expect(await direct.json()).toEqual({ candidates: [], error: "accounts_sign_in_required" });
});

test("an invalid contributor email is reported on Settings", async ({ page }) => {
  await page.goto(organizerLogin("sns-e2e-contributor-email", 24, "/settings"));
  await (await hydratedContributorSearch(page)).fill("someone@localhost");
  await page.getByRole("button", { name: "追加", exact: true }).click();

  await expect(page.getByText("有効なメールアドレスを入力してください。")).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  expect(queryLocalD1("SELECT user_email FROM sns_contributors WHERE chapter_id = 24")).toEqual([]);
});

test("an album URL outside Google Photos is reported on Settings", async ({ page }) => {
  await page.goto(organizerLogin("sns-e2e-album", 25, "/settings"));
  await hydratedContributorSearch(page);
  await page
    .getByPlaceholder("https://photos.google.com/share/...")
    .fill("https://example.com/album");
  await page.getByRole("button", { name: "アルバムを保存" }).click();

  await expect(
    page.getByText("公開 Google Photos アルバムの HTTPS URL を入力してください。"),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  expect(queryLocalD1("SELECT id FROM google_photos_albums WHERE chapter_id = 25")).toEqual([]);

  await page
    .getByPlaceholder("https://photos.google.com/share/...")
    .fill("https://photos.google.com/share/e2e-album");
  await page.getByRole("button", { name: "アルバムを保存" }).click();
  await expect(page.getByRole("button", { name: "監視を停止" })).toBeVisible();
  await expect(
    page.getByText("公開 Google Photos アルバムの HTTPS URL を入力してください。"),
  ).toHaveCount(0);
});
