import { type Page, expect, test } from "@playwright/test";

/**
 * Stage 09 end-to-end coverage (docs/roster/09-share-public-views.md "E2E").
 * The stage doc calls this "the most important E2E in the whole stage" —
 * it's the one fully public, unauthenticated screen, so the blast radius of
 * a data leak is direct. Items 3/4 from that section (no email in the HTML,
 * no "リード"/"経験あり"/"初参加" in the HTML) are the ones explicitly marked
 * "回帰として固定すべきテスト" and get their own hard assertions below.
 *
 * Fixture design: exactly 2 registrants, `ideal: 2` for the one demand
 * column, and `rosterx` marked unavailable ("×") for a single slot while
 * `rostery` is available all day. With only 2 candidates ever in play this
 * is deterministic (same seed -> same `solve()` output every run, index.md
 * §5.4): every slot except the marked one places both people (2 candidates,
 * ideal 2), and the marked slot places only `rostery`. That single gap is
 * what exercises the individual view's merge/break/companion-union logic
 * end-to-end (`../app/features/public-roster/timeline.ts` already covers the
 * algorithm itself in isolation; this proves the real solver+loader+UI path
 * produces the same shape a real staff member would actually see).
 */

async function setStatusOnStaffPage(page: Page, status: string): Promise<void> {
  await page.selectOption('select[name="status"]', status);
  await page.getByRole("button", { name: "ステータスを更新" }).click();
  await page.waitForLoadState("networkidle");
}

/** Same fixture builder as `roster.spec.ts` — see that file for why
 * `noSoloNewcomer` is turned off (every registrant defaults to level "new"). */
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

  await page.check('input[name="roleId"][value="reception"]');
  await page.getByRole("button", { name: "役割を保存" }).click();
  await expect(page.getByRole("checkbox", { name: "受付" })).toBeChecked();

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

/** Flips the token's last character so it decodes to a URL that cannot match. */
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

  // /e/:id/share while not published: shows the message, and the view URL is
  // visible even though it isn't live yet.
  await page.goto(`/e/${eventId}/share`);
  await expect(page.getByText("まだ公開されていません")).toBeVisible();
  const viewUrlText = (await page.locator("code").first().textContent())?.trim();
  if (!viewUrlText) throw new Error("view URL not found on /e/:id/share");
  const viewPath = new URL(viewUrlText).pathname;

  // The public page for a real (but unpublished) token is 200, not 404 — a
  // shared link must never look broken (docs/roster/09-share-public-views.md
  // "制約": "canView が false のとき 404 にしない").
  await page.context().clearCookies();
  const notPublished = await page.goto(viewPath);
  expect(notPublished?.status()).toBe(200);
  await expect(page.getByText("シフト表はまだ公開されていません。")).toBeVisible();

  // Generate the roster, then publish.
  await page.goto(`/dev/login?as=owner&chapter=1:e2e-public-owner&return_to=/e/${eventId}/roster`);
  await page.getByRole("button", { name: "自動生成" }).click();
  await page.waitForLoadState("networkidle");
  await page.goto(`/e/${eventId}/staff`);
  await setStatusOnStaffPage(page, "published");

  // A signed-out visitor sees the live shift table with no sign-in prompt.
  await page.context().clearCookies();
  const published = await page.goto(viewPath);
  expect(published?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "E2E Public Roster Event" })).toBeVisible();
  await expect(page.locator("table")).toBeVisible();

  // The single most important assertions in this stage: the raw HTML never
  // contains an email address or any experience-level wording, even though
  // neither is visibly rendered by the current UI — a loader regression
  // could still leak either through the hydration payload.
  const html = await page.content();
  expect(html).not.toContain("@dev.local");
  expect(html).not.toContain("リード");
  expect(html).not.toContain("経験あり");
  expect(html).not.toContain("初参加");

  // Role view renders (RoleGrid reused with readOnly).
  await page.getByRole("button", { name: "役割別" }).click();
  await expect(page.locator("table")).toBeVisible();

  // Individual view: rosterx has an explicit break at the marked slot,
  // splitting their day into 2 merged "assigned" blocks (before/after the
  // gap) that both list rostery as a companion — hence .first() below, the
  // same "appears more than once for a legitimate reason" pattern
  // roster.spec.ts uses for its own duplicate-text assertion. rostery's own
  // single whole-day block (no gap of their own) still lists rosterx as a
  // companion via the range-wide union even though rosterx is absent for one
  // sub-slot in the middle of that range.
  await page.getByRole("button", { name: "個人" }).click();
  await page.selectOption("select", { label: "rosterx (dev)" });
  await expect(page.getByText("休憩 / 担当なし")).toBeVisible();
  await expect(page.getByText(/一緒に:.*rostery/).first()).toBeVisible();

  await page.selectOption("select", { label: "rostery (dev)" });
  await expect(page.getByText(/一緒に:.*rosterx/)).toBeVisible();

  // hasParty defaults to false on /events/new — the 懇親会 tab must not exist.
  await expect(page.getByRole("button", { name: "懇親会" })).toHaveCount(0);

  // A token that doesn't decode to any event is a hard 404.
  const badPath = mutateToken(viewPath);
  const notFound = await page.goto(badPath);
  expect(notFound?.status()).toBe(404);
});
