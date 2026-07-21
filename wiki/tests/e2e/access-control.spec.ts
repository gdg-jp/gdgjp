import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, type BrowserContext, type Page, expect, test } from "@playwright/test";
import { TEST_PAGE } from "./global-setup";

const BASE = process.env.BASE_URL ?? "http://localhost:5177";
const PAGE_URL = `${BASE}/wiki/${TEST_PAGE.slug}`;
const STORAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "storage-state");

test.describe.configure({ mode: "serial" });

async function makePage(
  browser: Browser,
  storageFile?: "admin.json" | "author.json" | "member.json",
  viewport?: { width: number; height: number },
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    ...(storageFile ? { storageState: path.join(STORAGE_DIR, storageFile) } : {}),
    permissions: ["clipboard-read", "clipboard-write"],
    viewport,
  });
  return { ctx, page: await ctx.newPage() };
}

async function openShareDialog(page: Page) {
  const button = page.getByRole("button", { name: /share/i }).first();
  if (!(await button.isVisible().catch(() => false))) {
    const more = page.getByRole("button", { name: /more actions/i });
    await expect(more).toBeVisible({ timeout: 10_000 });
    await more.click();
  }
  await expect(button).toBeVisible({ timeout: 10_000 });
  const dialog = page.getByRole("dialog");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await button.click({ force: true });
    if (await dialog.isVisible().catch(() => false)) return button;
    await page.waitForTimeout(100);
  }
  await expect(dialog).toBeVisible();
  return button;
}

async function setGeneralAccess(page: Page, value: "restricted" | "unlisted" | "public") {
  const labels = {
    restricted: "Restricted",
    unlisted: "Anyone with the link",
    public: "Public",
  } as const;
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" && candidate.url().includes("/api/page-access/"),
  );
  await page.locator("#general-access").click();
  await page.getByRole("option", { name: labels[value], exact: true }).click();
  expect((await response).ok()).toBeTruthy();
}

test("Google Docs-style overview, copy, Escape and focus restoration", async ({ browser }) => {
  const { ctx, page } = await makePage(browser, "author.json");
  await page.goto(PAGE_URL);
  const trigger = await openShareDialog(page);

  await expect(page.getByRole("heading", { name: /Share.*E2E Test Page/i })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Add user" })).not.toBeFocused();
  await expect(page.getByRole("heading", { name: "People with access" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "General access" })).toBeVisible();
  await expect(page.locator("#general-role")).not.toBeVisible();

  await page.getByRole("heading", { name: /Share.*E2E Test Page/i }).click();
  await expect(page.getByRole("listbox")).not.toBeVisible();

  await page.getByRole("button", { name: /copy link/i }).click();
  await expect(page.getByRole("button", { name: /copied/i })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await ctx.close();
});

test("share suggestions and actions use the active color theme", async ({ browser }) => {
  const { ctx, page } = await makePage(browser, "author.json");
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto(PAGE_URL);
  await openShareDialog(page);

  const combobox = page.getByRole("combobox", { name: "Add user" });
  await combobox.fill("E2E");
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();

  const backgroundChannels = await listbox.evaluate((element) => {
    const match = getComputedStyle(element).backgroundColor.match(/[\d.]+/g);
    return match?.slice(0, 3).map(Number) ?? [];
  });
  expect(backgroundChannels).toHaveLength(3);
  expect(Math.max(...backgroundChannels)).toBeLessThan(128);

  const copyLinkButton = page.getByRole("button", { name: /copy link/i });
  const darkForeground = await copyLinkButton.evaluate(
    (element) => getComputedStyle(element).color,
  );
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  const lightForeground = await copyLinkButton.evaluate(
    (element) => getComputedStyle(element).color,
  );
  expect(darkForeground).not.toBe(lightForeground);
  await ctx.close();
});

test("combobox supports keyboard selection and multiple-chip grants", async ({ browser }) => {
  const { ctx, page } = await makePage(browser, "author.json");
  await page.goto(PAGE_URL);
  await openShareDialog(page);

  const combobox = page.getByRole("combobox", { name: "Add user" });
  await combobox.fill("E2E Member");
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(page.getByRole("option", { name: /E2E Member/ })).toBeVisible();
  await combobox.press("ArrowDown");
  await combobox.press("Enter");

  await expect(page.locator('input[role="combobox"]')).not.toBeFocused();
  await expect(page.getByRole("button", { name: /Remove E2E Member/ })).toBeVisible();
  await expect(page.locator("#grant-role")).toHaveText("Viewer");
  await expect(page.getByText("Notify people")).toBeVisible();
  await expect(page.getByPlaceholder("Message")).toBeVisible();

  const notifyCheckbox = page.getByRole("checkbox", { name: "Notify people" });
  await notifyCheckbox.uncheck();
  await expect(page.getByPlaceholder("Message")).toBeHidden();
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
  await notifyCheckbox.check();
  await expect(page.getByPlaceholder("Message")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();

  const addMore = page.getByRole("combobox", { name: "Add people or Chapters" });
  await addMore.fill("second@example.com");
  await expect(page.getByRole("option", { name: /second@example.com/ })).toBeVisible();
  await page.getByRole("option", { name: /second@example.com/ }).click();
  await expect(addMore).not.toBeFocused();

  await page.locator("#grant-role").click();
  await page.getByRole("option", { name: "Commenter", exact: true }).click();
  await page.getByPlaceholder("Message").fill("Welcome to this page");
  const requestPromise = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/api/page-access/"),
  );
  await page.getByRole("button", { name: "Send" }).click();
  const payload = (await requestPromise).postDataJSON();
  expect(payload.role).toBe("commenter");
  expect(payload.notify).toBe(true);
  expect(payload.message).toBe("Welcome to this page");
  expect(payload.targets).toHaveLength(2);
  await expect(page.getByRole("heading", { name: "People with access" })).toBeVisible({
    timeout: 5_000,
  });
  const memberRow = page.getByRole("listitem").filter({ hasText: "E2E Member" });
  await memberRow.getByRole("combobox").click();
  await expect(page.getByRole("option", { name: "Transfer ownership" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Remove access" })).toBeVisible();
  await expect(memberRow.getByRole("button", { name: /remove/i })).toHaveCount(0);
  await ctx.close();
});

test("general access has three modes and hides the role for Restricted", async ({ browser }) => {
  const { ctx, page } = await makePage(browser, "author.json");
  await page.goto(PAGE_URL);
  await openShareDialog(page);

  await page.locator("#general-access").click();
  await expect(page.getByRole("option")).toHaveCount(3);
  await expect(page.getByRole("option", { name: "Restricted", exact: true })).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Anyone with the link", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("option", { name: "Public", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await setGeneralAccess(page, "unlisted");
  const accessSelect = page.locator("#general-access");
  const generalRole = page.locator("#general-role");
  await expect(generalRole).toBeVisible();

  const accessBox = await accessSelect.boundingBox();
  const roleBox = await generalRole.boundingBox();
  expect(accessBox).not.toBeNull();
  expect(roleBox).not.toBeNull();
  expect(roleBox?.x).toBeGreaterThan((accessBox?.x ?? 0) + (accessBox?.width ?? 0));
  expect(Math.abs((roleBox?.y ?? 0) - (accessBox?.y ?? 0))).toBeLessThan(24);
  await ctx.close();
});

test("anonymous users can directly view unlisted pages but cannot discover them", async ({
  browser,
}) => {
  const { ctx: authorCtx, page: authorPage } = await makePage(browser, "author.json");
  await authorPage.goto(PAGE_URL);
  await openShareDialog(authorPage);
  await setGeneralAccess(authorPage, "unlisted");
  await authorCtx.close();

  const { ctx, page } = await makePage(browser);
  await page.goto(PAGE_URL);
  await expect(page.getByRole("heading", { name: "E2E Test Page" })).toBeVisible();
  await page.goto(BASE);
  await expect(page.getByRole("link", { name: "E2E Test Page" })).not.toBeVisible();
  await ctx.close();
});

test("anonymous top and sidebar expose public pages only", async ({ browser }) => {
  const { ctx: authorCtx, page: authorPage } = await makePage(browser, "author.json");
  await authorPage.goto(PAGE_URL);
  await openShareDialog(authorPage);
  await setGeneralAccess(authorPage, "public");
  await authorCtx.close();

  const { ctx, page } = await makePage(browser);
  await page.goto(BASE);
  await expect(page.getByRole("link", { name: "E2E Test Page" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  await ctx.close();
});

test("restricted pages reject anonymous direct access", async ({ browser }) => {
  const { ctx: authorCtx, page: authorPage } = await makePage(browser, "author.json");
  await authorPage.goto(PAGE_URL);
  await openShareDialog(authorPage);
  await setGeneralAccess(authorPage, "restricted");
  await authorCtx.close();

  const { ctx, page } = await makePage(browser);
  await page.goto(PAGE_URL);
  await expect(page.getByRole("heading", { name: "E2E Test Page" })).not.toBeVisible();
  await ctx.close();
});

test("mobile dialog is viewport-bound and scrollable", async ({ browser }) => {
  const { ctx, page } = await makePage(browser, "author.json", { width: 390, height: 844 });
  await page.goto(PAGE_URL);
  await openShareDialog(page);
  const box = await page.getByRole("dialog").boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width).toBeLessThanOrEqual(390);
  expect(box?.height).toBeLessThanOrEqual(844);
  await expect(page.getByRole("button", { name: /copy link/i })).toBeVisible();
  await ctx.close();
});

test("owner can transfer ownership from the role select", async ({ browser }) => {
  const { ctx, page } = await makePage(browser, "author.json");
  await page.goto(PAGE_URL);
  const grantResponse = await page.request.post(`${BASE}/api/page-access/${TEST_PAGE.id}`, {
    data: {
      intent: "add",
      subjectType: "email",
      subjectKey: "member@test.local",
      subjectLabel: "E2E Member",
      role: "editor",
    },
  });
  expect(grantResponse.ok()).toBeTruthy();

  await openShareDialog(page);
  const memberRow = page.getByRole("listitem").filter({ hasText: "E2E Member" });
  await memberRow.getByRole("combobox").click();
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      candidate.url().includes(`/api/page-access/${TEST_PAGE.id}`),
  );
  await page.getByRole("option", { name: "Transfer ownership" }).click();
  expect((await response).ok()).toBeTruthy();

  await expect(memberRow.getByText("Owner", { exact: true })).toBeVisible();
  const formerOwnerRow = page.getByRole("listitem").filter({ hasText: "E2E Author" });
  await expect(formerOwnerRow.getByRole("combobox")).toHaveText("Editor");
  await ctx.close();
});
