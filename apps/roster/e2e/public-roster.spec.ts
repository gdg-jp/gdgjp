import { type Page, expect, test } from "@playwright/test";

async function setStatusOnStaffPage(page: Page, status: string): Promise<void> {
  await page.selectOption('select[name="status"]', status);
  await page.getByRole("button", { name: "ステータスを更新" }).click();
  await page.waitForLoadState("networkidle");
}

async function createEventWithDemand(
  page: Page,
  eventName: string,
  ideal: number,
): Promise<string> {
  await page.goto("/dev/login?as=owner&chapter=1:e2e-public-owner&return_to=/events/new");
  await page.fill('input[name="name"]', eventName);
  await page.fill('input[name="date"]', "2030-06-01");
  await page.getByRole("button", { name: "作成する" }).click();
  await page.waitForURL(/\/e\/[^/]+\/(?:s\/[^/]+\/)?design$/);
  const eventId = new URL(page.url()).pathname.split("/")[2];

  await page.getByRole("checkbox", { name: "受付" }).check();
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.ok()),
    page.getByRole("button", { name: "役割を保存" }).click(),
  ]);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "受付" })).toBeChecked();

  await page.getByRole("checkbox", { name: "新人を単独の時間枠に割り当てない" }).uncheck();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.request().postData()?.includes("intent=updateSettings") === true &&
        response.ok(),
    ),
    page.getByRole("button", { name: "シフト表設定を保存" }).click(),
  ]);
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "新人を単独の時間枠に割り当てない" }),
  ).not.toBeChecked();

  await page.getByRole("button", { name: "役割を追加" }).click();
  await page
    .getByRole("button", { name: /需要なし/ })
    .first()
    .click();
  await page.fill('input[name="min"]', "1");
  await page.fill('input[name="ideal"]', String(ideal));
  await page.fill('input[name="leadMin"]', "0");
  await page.fill('input[name="newMax"]', "99");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForLoadState("networkidle");

  return eventId;
}

async function registerStaff(
  page: Page,
  applyPath: string,
  as: string,
  unavailableSlotLabel?: string,
): Promise<void> {
  await page.goto(`/dev/login?as=${as}&chapter=999:${as}-chapter&return_to=${applyPath}`);
  await page.check('input[name="role_reception"]');
  await page.getByRole("button", { name: "すべて解除" }).click();
  if (unavailableSlotLabel) {
    await page
      .locator("li", { hasText: unavailableSlotLabel })
      .locator("label", { hasText: "×" })
      .click();
  }
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByRole("button", { name: "登録内容を更新" })).toBeVisible();
}

function mutateToken(path: string): string {
  const last = path.at(-1);
  return `${path.slice(0, -1)}${last === "0" ? "1" : "0"}`;
}

test("public roster: not-published message, no PII/experience leakage once published, and 404 for an unknown token", async ({
  page,
}) => {
  const eventId = await createEventWithDemand(page, "E2E Public Roster Event", 2);

  await page.goto(`/e/${eventId}/staff`);
  const applyUrlText = (await page.locator("code").first().textContent())?.trim();
  if (!applyUrlText) throw new Error("apply URL not found on /e/:id/staff");
  const applyPath = new URL(applyUrlText).pathname;
  await setStatusOnStaffPage(page, "open");

  await registerStaff(page, applyPath, "rosterx", "10:00–11:00");
  await registerStaff(page, applyPath, "rostery");

  await page.goto(`/dev/login?as=owner&chapter=1:e2e-public-owner&return_to=/e/${eventId}/staff`);
  await setStatusOnStaffPage(page, "closed");

  await page.goto(`/e/${eventId}/share`);
  const legacyLink = page.getByText("本編の旧URLを確認");
  await legacyLink.click();
  await expect(page.getByText("本編は現在非公開です。", { exact: false })).toBeVisible();
  const viewUrlText = (await page.locator("details code").textContent())?.trim();
  if (!viewUrlText) throw new Error("view URL not found on /e/:id/share");
  const viewPath = new URL(viewUrlText).pathname;

  await page.context().clearCookies();
  const notPublished = await page.goto(viewPath);
  expect(notPublished?.status()).toBe(200);
  await expect(page.getByText("シフト表はまだ公開されていません。")).toBeVisible();

  await page.goto(`/dev/login?as=owner&chapter=1:e2e-public-owner&return_to=/e/${eventId}/roster`);
  await page.getByRole("button", { name: "自動生成" }).click();
  await page.waitForLoadState("networkidle");
  await page.goto(`/e/${eventId}`);
  await page.getByRole("button", { name: "公開にする", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await page.goto(`/e/${eventId}/staff`);
  await expect(page.locator('select[name="status"]')).toHaveValue("closed");

  await page.context().clearCookies();
  const published = await page.goto(viewPath);
  expect(published?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "E2E Public Roster Event" })).toBeVisible();
  await expect(page.locator("table")).toBeVisible();

  const html = await page.content();
  expect(html).not.toContain("@dev.local");
  expect(html).not.toContain("リード");
  expect(html).not.toContain("経験あり");
  expect(html).not.toContain("初参加");

  await page.getByRole("button", { name: "役割別" }).click();
  await expect(page.locator("table")).toBeVisible();

  await page.getByRole("button", { name: "個人" }).click();
  await page.selectOption("select", { label: "rosterx (dev)" });
  await expect(page.getByText("休憩 / 担当なし")).toBeVisible();
  await expect(page.getByText(/一緒に:.*rostery/).first()).toBeVisible();

  await page.selectOption("select", { label: "rostery (dev)" });
  await expect(page.getByText(/一緒に:.*rosterx/)).toBeVisible();

  await expect(page.getByRole("button", { name: "懇親会" })).toHaveCount(0);

  const badPath = mutateToken(viewPath);
  const notFound = await page.goto(badPath);
  expect(notFound?.status()).toBe(404);
});
