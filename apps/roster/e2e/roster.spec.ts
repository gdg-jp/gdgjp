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
  await page.goto("/dev/login?as=owner&chapter=1:e2e-roster-owner&return_to=/events/new");
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

test("generate produces a shift table with metrics, and re-generating with the same seed is deterministic", async ({
  page,
}) => {
  const eventId = await createEventWithDemand(page, "E2E Roster Generate Event", 2);

  await page.goto(`/e/${eventId}/staff`);
  const applyUrlText = (await page.locator("code").first().textContent())?.trim();
  if (!applyUrlText) throw new Error("apply URL not found on /e/:id/staff");
  const applyPath = new URL(applyUrlText).pathname;
  await setStatusOnStaffPage(page, "open");

  await registerStaff(page, applyPath, "roster1");
  await registerStaff(page, applyPath, "roster2");

  await page.goto(`/dev/login?as=owner&chapter=1:e2e-roster-owner&return_to=/e/${eventId}/staff`);
  await setStatusOnStaffPage(page, "closed");

  await page.goto(`/e/${eventId}/roster`);
  await expect(page.getByText("まだ生成していません")).toBeVisible();

  await page.getByRole("button", { name: "自動生成" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "再生成" })).toBeVisible();
  await expect(page.getByText("理想充足率")).toBeVisible();
  await expect(page.getByText(/前回の実行/)).toBeVisible();

  const idealRateFirst = await page.getByText("理想充足率").locator("xpath=..").textContent();

  await page.getByRole("button", { name: "再生成" }).click();
  await page.waitForLoadState("networkidle");
  const idealRateSecond = await page.getByText("理想充足率").locator("xpath=..").textContent();
  expect(idealRateSecond).toBe(idealRateFirst);

  await page.getByRole("button", { name: "役割別" }).click();
  await expect(page.locator("table")).toBeVisible();
  await page.getByRole("button", { name: "充足状況" }).click();
  await expect(page.locator("table")).toBeVisible();
  await page.getByRole("button", { name: "スタッフ別" }).click();
  await expect(page.locator("table")).toBeVisible();
});

test("manual edit: assigning into a slot marked unavailable warns but succeeds (warn-and-allow)", async ({
  page,
}) => {
  const eventId = await createEventWithDemand(page, "E2E Roster Manual Edit Event", 1);

  await page.goto(`/e/${eventId}/staff`);
  const applyUrlText = (await page.locator("code").first().textContent())?.trim();
  if (!applyUrlText) throw new Error("apply URL not found on /e/:id/staff");
  const applyPath = new URL(applyUrlText).pathname;
  await setStatusOnStaffPage(page, "open");

  await registerStaff(page, applyPath, "rosterx", "10:00–11:00");

  await page.goto(`/dev/login?as=owner&chapter=1:e2e-roster-owner&return_to=/e/${eventId}/staff`);
  await setStatusOnStaffPage(page, "closed");

  await page.goto(`/e/${eventId}/roster`);
  await expect(page.getByText("まだ生成していません")).toBeVisible();

  await page.getByRole("button", { name: "自動生成" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "充足状況" }).click();

  await page.locator("tr", { hasText: "10:00–11:00" }).getByRole("button").first().click();
  await expect(page.getByText("ここに入れられる人")).toBeVisible();
  const candidateRow = page.locator("li", { hasText: "rosterx" });
  await expect(candidateRow.getByText("稼働不可").first()).toBeVisible();
  await candidateRow.getByRole("button", { name: "追加" }).click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("ここに入れられる人")).toBeHidden();
  await page.getByRole("button", { name: "スタッフ別" }).click();
  await expect(page.getByText("稼働×")).toBeVisible();
});

test("multi-sheet availability, generation history, and publishing stay scoped to one sheet", async ({
  page,
  context,
}) => {
  const eventId = await createEventWithDemand(page, "E2E Multi-sheet Event", 1);

  await page.goto(`/e/${eventId}`);
  await page.getByRole("button", { name: "シフト表を追加" }).click();
  await page.fill('input[name="name"]', "懇親会");
  await page.fill('input[name="date"]', "2030-06-01");
  await page.fill('input[name="startTime"]', "19:00");
  await page.fill('input[name="endTime"]', "21:00");
  await page.getByText("詳細設定").click();
  await page.getByRole("combobox", { name: "時間枠の刻み幅" }).click();
  await page.getByRole("option", { name: "60分" }).click();
  await page.getByRole("checkbox", { name: "新人を単独の時間枠に割り当てない" }).uncheck();
  await page.getByRole("button", { name: "シフト表を作成" }).click();
  await page.waitForLoadState("networkidle");

  const partyCard = page
    .locator("li")
    .filter({ has: page.getByRole("heading", { name: "懇親会" }) });
  await expect(partyCard).toBeVisible();
  await partyCard.getByRole("link", { name: "設計を編集" }).click();
  await page.waitForURL(/\/e\/[^/]+\/s\/[^/]+\/design$/);
  const partySheetId = new URL(page.url()).pathname.split("/")[4];
  expect(partySheetId).toBeTruthy();

  await page.getByRole("checkbox", { name: "受付" }).check();
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.ok()),
    page.getByRole("button", { name: "役割を保存" }).click(),
  ]);
  await page.reload();
  const addTrackForm = page.getByRole("button", { name: "トラックを追加" }).locator("xpath=..");
  await addTrackForm.locator('input[name="name"]').fill("懇親会受付");
  await page.getByRole("button", { name: "トラックを追加" }).click();
  await page.waitForLoadState("networkidle");
  const addPhaseForm = page.getByRole("button", { name: "フェーズを追加" }).locator("xpath=..");
  await addPhaseForm.locator('input[name="name"]').fill("懇親会");
  await addPhaseForm.locator('input[name="from"]').fill("19:00");
  await addPhaseForm.locator('input[name="to"]').fill("21:00");
  await page.getByRole("button", { name: "フェーズを追加" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("時間枠（2）")).toBeVisible();
  await page.getByRole("button", { name: "役割を追加" }).click();
  await page.getByRole("button", { name: /需要なし/ }).click();
  await page.fill('input[name="min"]', "1");
  await page.fill('input[name="ideal"]', "1");
  await page.fill('input[name="leadMin"]', "0");
  await page.fill('input[name="newMax"]', "99");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForLoadState("networkidle");

  await page.goto(`/e/${eventId}/staff`);
  const applyUrlText = (await page.locator("code").first().textContent())?.trim();
  if (!applyUrlText) throw new Error("apply URL not found on /e/:id/staff");
  const applyPath = new URL(applyUrlText).pathname;
  await setStatusOnStaffPage(page, "open");
  await page.goto(
    `/dev/login?as=multisheet&chapter=999:multisheet-chapter&return_to=${encodeURIComponent(applyPath)}`,
  );
  await page.check('input[name="role_reception"]');
  const defaultGrid = page.getByRole("group", { name: /^本編 — 2030-06-01/ });
  const partyGrid = page.getByRole("group", { name: /^懇親会 — 2030-06-01/ });
  await expect(defaultGrid).toBeVisible();
  await expect(partyGrid).toBeVisible();
  await defaultGrid.getByRole("button", { name: "すべて解除" }).click();
  await partyGrid.getByRole("button", { name: "すべて解除" }).click();
  await partyGrid
    .locator("li", { hasText: "19:00–20:00" })
    .locator("label", { hasText: "×" })
    .click();
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByRole("button", { name: "登録内容を更新" })).toBeVisible();
  const defaultSlot = defaultGrid.locator("li", { hasText: "10:00–11:00" });
  await expect(defaultSlot.getByRole("checkbox", { name: "× 参加できない" })).not.toBeChecked();
  await expect(defaultSlot.getByRole("checkbox", { name: "△ できれば避けたい" })).not.toBeChecked();
  await expect(
    partyGrid
      .locator("li", { hasText: "19:00–20:00" })
      .getByRole("checkbox", { name: "× 参加できない" }),
  ).toBeChecked();
  await expect(
    partyGrid
      .locator("li", { hasText: "20:00–21:00" })
      .getByRole("checkbox", { name: "× 参加できない" }),
  ).not.toBeChecked();

  await page.goto(`/dev/login?as=owner&chapter=1:e2e-roster-owner&return_to=/e/${eventId}/staff`);
  await setStatusOnStaffPage(page, "closed");
  await page.goto(`/e/${eventId}/s/${partySheetId}/roster`);
  await expect(page.getByText("まだ生成していません")).toBeVisible();
  await page.getByRole("button", { name: "自動生成" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "再生成" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "履歴" })).toBeVisible();
  await expect(
    page.locator("section").filter({ hasText: "履歴" }).getByText("自動生成").first(),
  ).toBeVisible();
  await page.goto(`/e/${eventId}/roster`);
  await expect(page.getByText("まだ生成していません")).toBeVisible();

  await page.goto(`/e/${eventId}`);
  const partyCardAfterGenerate = page
    .locator("li")
    .filter({ has: page.getByRole("heading", { name: "懇親会" }) });
  await partyCardAfterGenerate.getByRole("button", { name: "公開にする" }).click();
  await page.waitForLoadState("networkidle");
  await page.goto(`/e/${eventId}/share`);
  const partyShareCard = page
    .locator("li")
    .filter({ has: page.getByRole("heading", { name: "懇親会" }) });
  await expect(partyShareCard.getByText("公開中", { exact: true })).toBeVisible();
  const partyUrl = (await partyShareCard.locator("code").textContent())?.trim();
  const legacyUrl = (await page.locator("code").first().textContent())?.trim();
  if (!partyUrl || !legacyUrl) throw new Error("public share URLs not found");

  await context.clearCookies();
  const partyResponse = await page.goto(partyUrl);
  expect(partyResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: /E2E Multi-sheet Event.*懇親会/ })).toBeVisible();
  await expect(page.getByText("multisheet")).toBeVisible();

  const legacyResponse = await page.goto(legacyUrl);
  expect(legacyResponse?.status()).toBe(200);
  await expect(page.getByText("シフト表はまだ公開されていません。")).toBeVisible();
  await expect(page.getByText("multisheet")).toHaveCount(0);
});
