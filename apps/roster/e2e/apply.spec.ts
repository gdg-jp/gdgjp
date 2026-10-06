import { type Page, expect, test } from "@playwright/test";

/**
 * Sets the event status and confirms it actually persisted server-side
 * before returning. `<select>`'s `toHaveValue` reflects the *client-side*
 * selection the instant `selectOption()` runs — it does not wait for the
 * form's POST to complete — so asserting on it right after a click can pass
 * before the write has landed. Reloading and re-checking forces a fresh
 * server-rendered `defaultValue`, which only reflects committed state.
 */
async function setEventStatus(page: Page, eventId: string, status: string): Promise<void> {
  await page.goto(`/e/${eventId}/staff`);
  await page.selectOption('select[name="status"]', status);
  await page.getByRole("button", { name: "ステータスを更新" }).click();
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.locator('select[name="status"]')).toHaveValue(status);
}

/**
 * Owner creates an event, selects the "reception" role, and opens
 * registration. Returns the event id and the public apply path so callers
 * can drive the rest of a flow from a clean, open event.
 */
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

/**
 * Full Stage 04 registration flow (docs/roster/04-applications.md
 * "手動 E2E" 1-13, condensed into one browser session by switching identity
 * through `/dev/login`): an owner creates and opens an event, an
 * unauthenticated visitor sees only the overview, a signed-in visitor from
 * a *different* Chapter can still register — the one non-negotiable
 * constraint of this stage (docs/roster/04-applications.md "Design" §4
 * 制約, "Chapter を要求しない") — and closing registration swaps the form
 * for "募集は終了しました" without 404ing (a live link must never look
 * broken).
 */
test("public registration: overview when signed out, form for any signed-in visitor, closed message once registration ends", async ({
  page,
}) => {
  const { eventId, applyPath } = await createAndOpenEvent(page, "E2E Apply Flow Event");

  // An unauthenticated visitor sees the event overview and the recruiting
  // role, but no registration form.
  await page.context().clearCookies();
  await page.goto(applyPath);
  await expect(page.getByText("受付")).toBeVisible();
  await expect(page.getByRole("link", { name: "サインインして登録する" })).toBeVisible();
  await expect(page.locator('input[name="name"]')).toHaveCount(0);

  // A visitor from a DIFFERENT Chapter can still register.
  await page.goto(`/dev/login?as=staff1&chapter=999:other-chapter&return_to=${applyPath}`);
  await expect(page.locator('input[name="name"]')).toHaveValue(/staff1/);

  await page.check('input[name="role_reception"]');
  await page.getByRole("button", { name: "すべて解除" }).click();
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByRole("button", { name: "登録内容を更新" })).toBeVisible();

  // Reopening the same URL shows the same registration in edit mode — not a
  // second, duplicate signup.
  await page.reload();
  await expect(page.getByRole("button", { name: "登録内容を更新" })).toBeVisible();

  // Closing registration swaps the form for the closed message.
  await page.goto(`/dev/login?as=owner&chapter=1:e2e-owner-chapter&return_to=/e/${eventId}/staff`);
  await setEventStatus(page, eventId, "closed");

  await page.goto(applyPath);
  await expect(page.getByText("募集は終了しました")).toBeVisible();
});

/**
 * ADR-008 proxy-add + claim, end to end through the real forms (not just
 * the unit-tested resolver function) — manual E2E steps 11-12 in
 * docs/roster/04-applications.md. The owner types the proxy email in a
 * DIFFERENT case than the claimant's account email on purpose: this is the
 * exact case-sensitivity gap found in review (applications.server.ts's
 * email normalization) — proxy-add and self-registration go through two
 * different routes, so only an end-to-end pass through both real forms
 * proves they're wired to the same normalized identity key.
 */
test("proxy-add: owner registers by email, and that person's sign-in claims it despite different email casing", async ({
  page,
}) => {
  const { applyPath } = await createAndOpenEvent(page, "E2E Proxy Claim Event");

  // Owner proxy-registers someone by email, typed in a different case than
  // the account email that will sign in below.
  await page.getByRole("button", { name: "メールアドレスで代理登録" }).click();
  await page.fill('input[name="email"]', "Claimee@Dev.Local");
  await page.fill('input[name="name"]', "Proxy Claimee");
  await page.check('input[name="role_reception"]');
  await page.getByRole("button", { name: "すべて解除" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "登録する" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  // The claimee signs in with the lowercase account email `/dev/login`
  // derives from `as` — different casing than what the owner typed above.
  await page.context().clearCookies();
  await page.goto(`/dev/login?as=claimee&chapter=999:claimee-chapter&return_to=${applyPath}`);

  // The proxy registration's content shows up as their own, in edit mode —
  // proof the claim matched despite the casing difference.
  await expect(page.locator('input[name="name"]')).toHaveValue("Proxy Claimee");
  await expect(page.getByRole("button", { name: "登録内容を更新" })).toBeVisible();
});
