import { type Page, expect, test } from "@playwright/test";

async function setEventStatus(page: Page, eventId: string, status: string): Promise<void> {
  await page.goto(`/e/${eventId}/staff`);
  await page.selectOption('select[name="status"]', status);
  await page.getByRole("button", { name: "ステータスを更新" }).click();
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.locator('select[name="status"]')).toHaveValue(status);
}

async function createAndOpenEvent(
  page: Page,
  eventName: string,
): Promise<{ eventId: string; applyPath: string }> {
  await page.goto("/dev/login?as=owner&chapter=1:e2e-owner-chapter&return_to=/events/new");
  await page.fill('input[name="name"]', eventName);
  await page.fill('input[name="date"]', "2030-06-01");
  await page.getByRole("button", { name: "作成する" }).click();
  await page.waitForURL(/\/e\/[^/]+\/(?:s\/[^/]+\/)?design$/);
  const eventId = new URL(page.url()).pathname.split("/")[2];

  await page.getByRole("checkbox", { name: "受付" }).check();
  await page.getByRole("button", { name: "役割を保存" }).click();
  await expect(page.getByRole("checkbox", { name: "受付" })).toBeChecked();

  await setEventStatus(page, eventId, "open");

  await page.goto(`/e/${eventId}/staff`);
  const applyUrlText = (await page.locator("code").first().textContent())?.trim();
  if (!applyUrlText) throw new Error("apply URL not found on /e/:id/staff");
  const applyPath = new URL(applyUrlText).pathname;

  return { eventId, applyPath };
}

test("public registration: overview when signed out, form for any signed-in visitor, closed message once registration ends", async ({
  page,
}) => {
  const { eventId, applyPath } = await createAndOpenEvent(page, "E2E Apply Flow Event");

  await page.context().clearCookies();
  await page.goto(applyPath);
  await expect(page.getByText("受付")).toBeVisible();
  await expect(page.getByRole("link", { name: "サインインして登録する" })).toBeVisible();
  await expect(page.locator('input[name="name"]')).toHaveCount(0);

  await page.goto(`/dev/login?as=staff1&chapter=999:other-chapter&return_to=${applyPath}`);
  await expect(page.locator('input[name="name"]')).toHaveValue(/staff1/);

  await page.check('input[name="role_reception"]');
  await page.getByRole("button", { name: "すべて解除" }).click();
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByRole("button", { name: "登録内容を更新" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "登録内容を更新" })).toBeVisible();

  await page.goto(`/dev/login?as=owner&chapter=1:e2e-owner-chapter&return_to=/e/${eventId}/staff`);
  await setEventStatus(page, eventId, "closed");

  await page.goto(applyPath);
  await expect(page.getByText("募集は終了しました")).toBeVisible();
});

test("proxy-add: owner registers by email, and that person's sign-in claims it despite different email casing", async ({
  page,
}) => {
  const { applyPath } = await createAndOpenEvent(page, "E2E Proxy Claim Event");

  await page.getByRole("button", { name: "メールアドレスで代理登録" }).click();
  await page.fill('input[name="email"]', "Claimee@Dev.Local");
  await page.fill('input[name="name"]', "Proxy Claimee");
  await page.check('input[name="role_reception"]');
  await page.getByRole("button", { name: "すべて解除" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "登録する" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.context().clearCookies();
  await page.goto(`/dev/login?as=claimee&chapter=999:claimee-chapter&return_to=${applyPath}`);

  await expect(page.locator('input[name="name"]')).toHaveValue("Proxy Claimee");
  await expect(page.getByRole("button", { name: "登録内容を更新" })).toBeVisible();
});

test("custom role: owner creates and renames an event-owned role, and staff can register for it", async ({
  page,
}) => {
  await page.goto("/dev/login?as=owner&chapter=1:e2e-owner-chapter&return_to=/events/new");
  await page.fill('input[name="name"]', "E2E Custom Role Event");
  await page.fill('input[name="date"]', "2030-06-01");
  await page.getByRole("button", { name: "作成する" }).click();
  await page.waitForURL(/\/e\/[^/]+\/(?:s\/[^/]+\/)?design$/);
  const eventId = new URL(page.url()).pathname.split("/")[2];

  await page.getByLabel("新しい役割").fill("クローク");
  await page.getByRole("button", { name: "役割を作成" }).click();
  await expect(page.getByRole("checkbox", { name: "クローク" })).toBeChecked();

  await page.getByLabel("「クローク」の名前").fill("クローク・荷物");
  await page.getByRole("button", { name: "名前を変更" }).click();
  await expect(page.getByRole("checkbox", { name: "クローク・荷物" })).toBeChecked();

  await setEventStatus(page, eventId, "open");
  const applyUrlText = (await page.locator("code").first().textContent())?.trim();
  if (!applyUrlText) throw new Error("apply URL not found on /e/:id/staff");
  const applyPath = new URL(applyUrlText).pathname;

  await page.goto(`/dev/login?as=staff-custom&chapter=999:other-chapter&return_to=${applyPath}`);
  await page.getByRole("checkbox", { name: "クローク・荷物" }).check();
  await page.getByRole("button", { name: "すべて解除" }).click();
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByRole("button", { name: "登録内容を更新" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "クローク・荷物" })).toBeChecked();
});
