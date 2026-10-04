import { type Page, expect, test } from "@playwright/test";

/**
 * Stage 07 end-to-end coverage (docs/roster/07-roster-manual-edit.md "手動
 * E2E"). Drives the real forms all the way from event creation through
 * generation and a manual edit — there is no seeding shortcut for domain
 * data yet (`/dev/seed` is still a Stage 01 stub), so every fixture below
 * goes through the actual `/events/new` -> `/e/:id/design` ->
 * `/apply/:token` -> `/e/:id/roster` flow, switching identity through
 * `/dev/login` the same way `apply.spec.ts` does.
 */

/** `/e/:id/staff`'s status select (`ApplyLinkCard`, button "ステータスを更新"). */
async function setStatusOnStaffPage(page: Page, status: string): Promise<void> {
  await page.selectOption('select[name="status"]', status);
  await page.getByRole("button", { name: "ステータスを更新" }).click();
  await page.waitForLoadState("networkidle");
}

/** Owner creates an event, selects "reception", and sets one demand cell
 * (min 1 / ideal `ideal` / leadMin 0 / newMax 99) covering every time slot —
 * the default event has no phases yet, so the demand matrix's single
 * "フェーズ未設定" row fans the write out to all of them at once. */
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

  await page.check('input[name="roleId"][value="reception"]');
  await page.getByRole("button", { name: "役割を保存" }).click();
  await expect(page.getByRole("checkbox", { name: "受付" })).toBeChecked();

  // Every fixture here has too few applicants for the default "初参加者の
  // 単独配置：禁止する" (no_solo_newcomer) rule to ever let a demand cell
  // reach its full `ideal` — everyone self-registers at the default "new"
  // level, and filling the LAST seat with a newcomer and nobody experienced
  // already present is exactly what that rule blocks (index.md §5.2 step
  // ②-④'s newcomer gate). Turn it off so `solve()` actually places people.
  // Wait for the save's response itself: networkidle may already hold before the POST starts,
  // and reloading early drops the write.
  await page.getByRole("checkbox", { name: "新人を単独の時間枠に割り当てない" }).uncheck();
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.ok()),
    page.getByRole("button", { name: "シフト表設定を保存" }).click(),
  ]);
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "新人を単独の時間枠に割り当てない" }),
  ).not.toBeChecked();

  // The demand matrix starts with zero columns — "役割を追加" (trackId/roleId
  // default to the only options: 全体/受付) adds the column the empty cell
  // beneath it then becomes clickable.
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

/** Registers `as` for `reception` with every slot available ("終日 ○"),
 * except `unavailableSlotLabel` (e.g. "10:00–11:00"), which is forced to
 * "×" — the fixture the warn-and-allow test below assigns into anyway. */
async function registerStaff(
  page: Page,
  applyPath: string,
  as: string,
  unavailableSlotLabel?: string,
): Promise<void> {
  await page.goto(`/dev/login?as=${as}&chapter=999:${as}-chapter&return_to=${applyPath}`);
  await page.check('input[name="role_reception"]');
  await page.getByRole("button", { name: "終日 ○" }).click();
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

  // Same seed (the field keeps its submitted value) -> same result: the
  // whole metrics tile (label + value + detail) must read identically.
  const idealRateFirst = await page.getByText("理想充足率").locator("xpath=..").textContent();

  await page.getByRole("button", { name: "再生成" }).click();
  await page.waitForLoadState("networkidle");
  const idealRateSecond = await page.getByText("理想充足率").locator("xpath=..").textContent();
  expect(idealRateSecond).toBe(idealRateFirst);

  // All 3 views render.
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

  // This person is unavailable ("×") for the 10:00–11:00 slot specifically.
  await registerStaff(page, applyPath, "rosterx", "10:00–11:00");

  await page.goto(`/dev/login?as=owner&chapter=1:e2e-roster-owner&return_to=/e/${eventId}/staff`);
  await setStatusOnStaffPage(page, "closed");

  await page.goto(`/e/${eventId}/roster`);
  await expect(page.getByText("まだ生成していません")).toBeVisible();

  // The 3 grid views only appear once a shift table exists
  // (docs/roster/07-roster-manual-edit.md "Verification" #1) — generate
  // first. rosterx is the only applicant and is marked "×" for 10:00–11:00,
  // so auto-generation (which never violates a hard constraint) must leave
  // that exact cell empty, setting up the manual-override case below.
  await page.getByRole("button", { name: "自動生成" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "充足状況" }).click();

  // The 10:00–11:00 row's only demand cell (受付 / 全体) — click it to open
  // DemandCellDrawer and pick the unavailable candidate.
  await page.locator("tr", { hasText: "10:00–11:00" }).getByRole("button").first().click();
  await expect(page.getByText("ここに入れられる人")).toBeVisible();
  const candidateRow = page.locator("li", { hasText: "rosterx" });
  // "稼働不可" appears twice for this candidate: once as the category label
  // and once inside hardViolations' own warning sentence — either is proof
  // the warning surfaced, so .first() is enough.
  await expect(candidateRow.getByText("稼働不可").first()).toBeVisible();
  await candidateRow.getByRole("button", { name: "追加" }).click();
  await page.waitForLoadState("networkidle");

  // The dialog closes on success and the cell now shows a violation.
  await expect(page.getByText("ここに入れられる人")).toBeHidden();
  await page.getByRole("button", { name: "スタッフ別" }).click();
  await expect(page.getByText("稼働×")).toBeVisible();
});
