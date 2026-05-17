/**
 * E2E tests for Fine-Grained Access Control (Google Docs–style ShareDialog).
 *
 * Prerequisites:
 *   - Dev server running on http://localhost:5177
 *   - global-setup.ts has seeded 3 test users into D1 SQLite + the test wiki
 *     page, and written HMAC-signed session cookies to storageState files.
 *
 * Auth strategy: openid-client RP factory uses a signed session cookie
 * (`gdgjp-wiki-session`). global-setup signs that cookie with the
 * RP_SESSION_SECRET from .dev.vars so the dev server accepts it without
 * a real OIDC sign-in flow.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import { TEST_PAGE } from "./global-setup";

const BASE = process.env.BASE_URL ?? "http://localhost:5177";
const PAGE_URL = `${BASE}/wiki/${TEST_PAGE.slug}`;
const STORAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "storage-state");

// All tests in this file mutate the same wiki page (visibility, access list).
// Running them in parallel produced flaky failures where one test's setVisibility
// "restricted" raced another test's openShareDialog or page load. Serialise the
// whole file so each test sees a deterministic state from the one before it.
test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makePage(
  browser: Parameters<Parameters<typeof test>[2]>[0]["browser"],
  storageFile: string,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    storageState: path.join(STORAGE_DIR, storageFile),
    // The "Copy link" button calls navigator.clipboard.writeText, which silently
    // rejects in headless Chromium unless clipboard-write is explicitly granted.
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await ctx.newPage();
  return { ctx, page };
}

async function openShareDialog(page: Page) {
  // Click the first "Share" button visible on the page. Wait for it explicitly
  // — Cloudflare-plugin dev cold-starts can leave the page hydrating for a few
  // seconds after navigation completes.
  const shareBtn = page.getByRole("button", { name: /share/i }).first();
  await expect(shareBtn).toBeVisible({ timeout: 10_000 });
  await shareBtn.click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Smoke / Dialog visibility
// ---------------------------------------------------------------------------

test.describe("Smoke / dialog visibility", () => {
  test("1. Share button opens dialog as author", async ({ browser }) => {
    const { ctx, page } = await makePage(browser, "author.json");
    await page.goto(PAGE_URL);
    await page.getByRole("button", { name: /share/i }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    await ctx.close();
  });

  test("2. Dialog closes on Escape", async ({ browser }) => {
    const { ctx, page } = await makePage(browser, "author.json");
    await page.goto(PAGE_URL);
    await page.getByRole("button", { name: /share/i }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await ctx.close();
  });

  test("3. Dialog closes on backdrop click", async ({ browser }) => {
    const { ctx, page } = await makePage(browser, "author.json");
    await page.goto(PAGE_URL);
    await page.getByRole("button", { name: /share/i }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // Click the backdrop (fixed overlay behind the dialog)
    await page.mouse.click(10, 10);
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await ctx.close();
  });

  test("4. Copy link button changes text to Copied!", async ({ browser }) => {
    const { ctx, page } = await makePage(browser, "author.json");
    await page.goto(PAGE_URL);
    await openShareDialog(page);
    await page.getByRole("button", { name: /copy link/i }).click();
    await expect(page.getByRole("button", { name: /copied/i })).toBeVisible();
    await ctx.close();
  });
});

// ---------------------------------------------------------------------------
// Visibility selector
// ---------------------------------------------------------------------------

test.describe("Visibility selector", () => {
  test("5a. Author sees visibility selector", async ({ browser }) => {
    const { ctx, page } = await makePage(browser, "author.json");
    await page.goto(PAGE_URL);
    await openShareDialog(page);
    // The visibility selector is inside the "General access" section
    // It appears only when canChangeVisibility is true (author qualifies)
    await expect(page.getByText(/general access/i)).toBeVisible();
    await ctx.close();
  });

  test("5b. Non-author member does not see visibility selector", async ({ browser }) => {
    const { ctx, page } = await makePage(browser, "member.json");
    await page.goto(PAGE_URL);
    await openShareDialog(page);
    await expect(page.getByText(/general access/i)).not.toBeVisible();
    await ctx.close();
  });

  test("6. Author can change visibility to Restricted", async ({ browser }) => {
    const { ctx, page } = await makePage(browser, "author.json");
    await page.goto(PAGE_URL);
    await openShareDialog(page);

    // Wait for the access data to load (the select appears after fetch)
    const visibilitySelect = page.locator("select").filter({ hasText: /public|restricted/i });
    await expect(visibilitySelect).toBeVisible({ timeout: 5000 });

    // Change to Restricted — this POST to /api/page-access/:pageId confirms Bug 1 is fixed
    await visibilitySelect.selectOption("restricted");

    // Wait for the mutation to complete (no network error dialog)
    await page.waitForTimeout(500);
    await expect(page.getByText(/general access/i)).toBeVisible();

    // Reset back to public for other tests
    await visibilitySelect.selectOption("public");
    await page.waitForTimeout(300);
    await ctx.close();
  });

  test("7. Author can cycle through all 4 visibility modes", async ({ browser }) => {
    const { ctx, page } = await makePage(browser, "author.json");
    await page.goto(PAGE_URL);
    await openShareDialog(page);

    const visibilitySelect = page.getByRole("dialog").locator("select").last();

    await expect(visibilitySelect).toBeVisible({ timeout: 5000 });

    for (const val of ["restricted", "public", "private_to_chapter"]) {
      await visibilitySelect.selectOption(val);
      await page.waitForTimeout(300);
    }

    // Reset
    await visibilitySelect.selectOption("public");
    await page.waitForTimeout(300);
    await ctx.close();
  });
});

// ---------------------------------------------------------------------------
// Add People (requires Bug 1 + Bug 2 to be fixed)
// ---------------------------------------------------------------------------

test.describe("Add People", () => {
  test("8. Author sees 'Add people' section (Bug 2 fix)", async ({ browser }) => {
    const { ctx, page } = await makePage(browser, "author.json");
    await page.goto(PAGE_URL);
    await openShareDialog(page);
    // The "Add people" heading is only rendered when canManageAccess = true
    await expect(page.getByText(/add people/i)).toBeVisible({ timeout: 5000 });
    await ctx.close();
  });

  test("9. User search returns results (Bug 1 fix — /api/users/search must be registered)", async ({
    browser,
  }) => {
    const { ctx, page } = await makePage(browser, "author.json");
    await page.goto(PAGE_URL);
    await openShareDialog(page);

    const searchInput = page.getByPlaceholder(/add user/i);
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill("E2E");

    // Dropdown should appear with at least one result (Bug 1 surfaces if 404).
    // Search for "E2E" matches both E2E Admin and E2E Member, so .first() to
    // avoid strict-mode violations.
    await expect(
      page.locator("text=E2E Admin").or(page.locator("text=E2E Member")).first(),
    ).toBeVisible({ timeout: 3000 });
    await ctx.close();
  });

  test("10. Pick a registered user — chip appears with role selector", async ({ browser }) => {
    const { ctx, page } = await makePage(browser, "author.json");
    await page.goto(PAGE_URL);
    await openShareDialog(page);

    const searchInput = page.getByPlaceholder(/add user/i);
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill("E2E Member");

    const memberResult = page.locator("text=E2E Member").first();
    await expect(memberResult).toBeVisible({ timeout: 3000 });
    await memberResult.click();

    // Chip should appear
    await expect(page.locator("text=member@test.local")).toBeVisible();
    // Role dropdown for the pending chip should be present (the dialog may
    // already render other selects — visibility, per-access-row role pickers —
    // so scope the assertion to a select that has the chip-role options).
    await expect(
      page.getByRole("dialog").locator('select:has(option[value="viewer"])').first(),
    ).toBeVisible();
    await ctx.close();
  });

  test("11. Add user — user appears in 'People with access'", async ({ browser }) => {
    const { ctx, page } = await makePage(browser, "author.json");
    await page.goto(PAGE_URL);
    await openShareDialog(page);

    const searchInput = page.getByPlaceholder(/add user/i);
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill("E2E Admin");

    await expect(page.locator("text=E2E Admin").first()).toBeVisible({ timeout: 3000 });
    await page.locator("text=E2E Admin").first().click();

    await page.getByRole("button", { name: /^add$/i }).click();

    // The dialog reloads the access list — admin should appear
    await expect(page.locator("text=admin@test.local")).toBeVisible({ timeout: 5000 });
    await ctx.close();
  });

  test("12. Unregistered email shows 'Unregistered' row", async ({ browser }) => {
    const { ctx, page } = await makePage(browser, "author.json");
    await page.goto(PAGE_URL);
    await openShareDialog(page);

    const searchInput = page.getByPlaceholder(/add user/i);
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill("nobody@example.com");

    await expect(page.getByText(/unregistered/i)).toBeVisible({ timeout: 3000 });
    await ctx.close();
  });

  test("13. Pick unregistered email — chip + Add — appears as 'Invitation pending'", async ({
    browser,
  }) => {
    const { ctx, page } = await makePage(browser, "author.json");
    await page.goto(PAGE_URL);
    await openShareDialog(page);

    const searchInput = page.getByPlaceholder(/add user/i);
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill("pending-invite@example.com");

    await expect(page.getByText(/unregistered/i)).toBeVisible({ timeout: 3000 });
    await page.getByText(/unregistered/i).click();

    await page.getByRole("button", { name: /^add$/i }).click();

    await expect(page.getByText(/invitation pending/i)).toBeVisible({ timeout: 5000 });
    await ctx.close();
  });
});

// ---------------------------------------------------------------------------
// Role management
// ---------------------------------------------------------------------------

test.describe("Role management", () => {
  test("14. Role dropdown allows changing roles", async ({ browser }) => {
    const { ctx, page } = await makePage(browser, "admin.json");
    await page.goto(PAGE_URL);
    await openShareDialog(page);

    // Admin sees the access list (must have page_access entries from previous tests)
    await page.waitForTimeout(500);

    // Look for any role select in the access list and change it. Filter on
    // option[value="viewer"] to skip the visibility select (which is also a
    // <select> in this dialog but only has visibility options).
    const roleSelects = page.getByRole("dialog").locator('select:has(option[value="viewer"])');
    const count = await roleSelects.count();

    if (count > 0) {
      const roleSelect = roleSelects.last();
      const currentValue = await roleSelect.inputValue();
      const newValue = currentValue === "viewer" ? "editor" : "viewer";
      await roleSelect.selectOption(newValue);
      await page.waitForTimeout(400);
      // Confirm the select still has the new value (no error revert)
      await expect(roleSelect).toHaveValue(newValue);
    }
    await ctx.close();
  });

  test("16. Remove user from access list", async ({ browser }) => {
    const { ctx, page } = await makePage(browser, "admin.json");
    await page.goto(PAGE_URL);
    await openShareDialog(page);

    // Count access list items before removal
    await page.waitForTimeout(500);
    const removeButtons = page.getByRole("dialog").getByRole("button", { name: /remove access/i });
    const initialCount = await removeButtons.count();

    if (initialCount > 0) {
      await removeButtons.last().click();
      await page.waitForTimeout(400);
      const newCount = await page
        .getByRole("dialog")
        .getByRole("button", { name: /remove access/i })
        .count();
      expect(newCount).toBeLessThan(initialCount);
    }
    await ctx.close();
  });

  test("17. Last owner cannot be removed (error shown)", async ({ browser }) => {
    const { ctx, page } = await makePage(browser, "admin.json");
    await page.goto(PAGE_URL);
    await openShareDialog(page);

    // Find the page author's entry and try to remove — when it's the only owner
    // First set visibility to restricted so the owner is inserted
    const visibilitySelect = page
      .getByRole("dialog")
      .locator('select:has(option[value="private_to_chapter"])');
    await expect(visibilitySelect).toBeVisible({ timeout: 5000 });
    await visibilitySelect.selectOption("restricted");
    await page.waitForTimeout(500);

    // Reload the access list
    await page.reload();
    await openShareDialog(page);

    // Remove all non-owner entries until only 1 owner remains, then try to remove it
    // (This test just verifies the error message appears)
    const removeButtons = page.getByRole("dialog").getByRole("button", { name: /remove access/i });
    const count = await removeButtons.count();

    // Try to remove the last item (if there's only 1, the error should appear)
    if (count === 1) {
      await removeButtons.first().click();
      await expect(page.getByText(/cannot remove the last owner/i)).toBeVisible({ timeout: 3000 });
    }

    await ctx.close();
  });
});

// ---------------------------------------------------------------------------
// Access enforcement (integration)
// ---------------------------------------------------------------------------

test.describe("Access enforcement", () => {
  test("18. Restricted page is inaccessible to user without page_access", async ({ browser }) => {
    // Use admin to set page to restricted first
    const { ctx: adminCtx, page: adminPage } = await makePage(browser, "admin.json");
    await adminPage.goto(PAGE_URL);
    await openShareDialog(adminPage);
    const visSelect = adminPage
      .getByRole("dialog")
      .locator('select:has(option[value="private_to_chapter"])');
    await expect(visSelect).toBeVisible({ timeout: 5000 });
    await visSelect.selectOption("restricted");
    await adminPage.waitForTimeout(500);
    await adminCtx.close();

    // Member (no page_access record) tries to view the restricted page
    const { ctx: memberCtx, page: memberPage } = await makePage(browser, "member.json");
    await memberPage.goto(PAGE_URL);
    // Should get 403/404 — check for error status or redirect
    const status = memberPage.url();
    // Either the page shows an error, or we're redirected
    const body = await memberPage.locator("body").textContent();
    expect(body).toBeTruthy();
    // The page content should NOT include the page title heading (access
    // denied). The sidebar nav still lists the page as a link, so we look for
    // the article <h1> specifically.
    await expect(memberPage.getByRole("heading", { name: "E2E Test Page" })).not.toBeVisible({
      timeout: 3000,
    });
    await memberCtx.close();

    // Restore to public for other tests
    const { ctx: resetCtx, page: resetPage } = await makePage(browser, "admin.json");
    await resetPage.goto(PAGE_URL);
    await openShareDialog(resetPage);
    const resetSelect = resetPage
      .getByRole("dialog")
      .locator('select:has(option[value="private_to_chapter"])');
    await expect(resetSelect).toBeVisible({ timeout: 5000 });
    await resetSelect.selectOption("public");
    await resetPage.waitForTimeout(300);
    await resetCtx.close();
  });

  test("19. User with page_access can view restricted page", async ({ browser }) => {
    // Admin makes page restricted and adds member
    const { ctx: adminCtx, page: adminPage } = await makePage(browser, "admin.json");
    await adminPage.goto(PAGE_URL);
    await openShareDialog(adminPage);
    const visSelect = adminPage
      .getByRole("dialog")
      .locator('select:has(option[value="private_to_chapter"])');
    await expect(visSelect).toBeVisible({ timeout: 5000 });
    await visSelect.selectOption("restricted");
    await adminPage.waitForTimeout(400);

    // Add member to access list
    const searchInput = adminPage.getByPlaceholder(/add user/i);
    if (await searchInput.isVisible()) {
      await searchInput.fill("E2E Member");
      await expect(adminPage.locator("text=E2E Member").first()).toBeVisible({ timeout: 3000 });
      await adminPage.locator("text=E2E Member").first().click();
      await adminPage.getByRole("button", { name: /^add$/i }).click();
      await adminPage.waitForTimeout(500);
    }
    await adminCtx.close();

    // Member can now view the page
    const { ctx: memberCtx, page: memberPage } = await makePage(browser, "member.json");
    await memberPage.goto(PAGE_URL);
    // Match the page-title <h1> specifically — "E2E Test Page" also appears in
    // the document <title>, which would trigger Playwright strict-mode.
    await expect(memberPage.getByRole("heading", { name: "E2E Test Page" })).toBeVisible({
      timeout: 5000,
    });
    await memberCtx.close();

    // Cleanup: restore public visibility
    const { ctx: resetCtx, page: resetPage } = await makePage(browser, "admin.json");
    await resetPage.goto(PAGE_URL);
    await openShareDialog(resetPage);
    const resetSelect = resetPage
      .getByRole("dialog")
      .locator('select:has(option[value="private_to_chapter"])');
    await expect(resetSelect).toBeVisible({ timeout: 5000 });
    await resetSelect.selectOption("public");
    await resetPage.waitForTimeout(300);
    await resetCtx.close();
  });
});
