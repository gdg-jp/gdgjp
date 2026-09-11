import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function createPage(
  page: Page,
  label: string,
  content = "## Heading\n\nPage menu body",
  contentEn = content,
) {
  const title = `${label} ${crypto.randomUUID()}`;
  const response = await page.request.post("/wiki/new", {
    form: { titleJa: title, titleEn: title, contentJa: content, contentEn },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  const path = response.headers().location;
  const id = response.headers()["x-wiki-page-id"];
  if (!id) throw new Error("New page response did not include its resource ID");
  return { id, path, title };
}

const more = (page: Page) => page.getByRole("button", { name: /More actions|その他の操作/ });

test("desktop menu copies Markdown and persists page-local display settings", async ({
  authorPage,
}) => {
  await authorPage.setViewportSize({ width: 1440, height: 1000 });
  await authorPage.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const first = await createPage(authorPage, "Menu display");
  const second = await createPage(authorPage, "Menu other");
  await authorPage.goto(`${first.path}?lang=en`);
  await expect(authorPage.locator("article")).toBeVisible();
  const normalWidth = await authorPage
    .locator("article")
    .evaluate((element) => element.getBoundingClientRect().width);
  await more(authorPage).click();
  const menu = authorPage.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Copy link",
    "Copy page contents",
    "Duplicate",
    "Move to",
    "Move to Trash",
  ]);
  await authorPage.screenshot({
    path: test.info().outputPath("desktop-menu.png"),
    animations: "disabled",
  });
  await menu.getByRole("menuitemcheckbox", { name: "Small text" }).click();
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitemcheckbox", { name: "Full width" }).click();
  await expect(authorPage.locator("article")).toHaveAttribute("data-small-text", "true");
  await expect
    .poll(() =>
      authorPage.locator("article").evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeGreaterThan(normalWidth);
  await expect
    .poll(() =>
      authorPage
        .locator(".md-editor-preview")
        .evaluate((element) => getComputedStyle(element).fontSize),
    )
    .toBe("14px");
  await authorPage.keyboard.press("Escape");
  await expect(more(authorPage)).toBeFocused();
  await authorPage.reload();
  await expect(more(authorPage)).toBeEnabled();
  await more(authorPage).focus();
  await authorPage.keyboard.press("Enter");
  await expect(menu.getByRole("menuitem", { name: "Copy link", exact: true })).toBeFocused();
  await expect(menu.getByRole("menuitemcheckbox", { name: "Full width" })).toBeChecked();
  await menu.getByRole("menuitem", { name: "Copy link", exact: true }).click();
  await expect
    .poll(() => authorPage.evaluate(() => navigator.clipboard.readText()))
    .toBe(authorPage.url());
  await more(authorPage).click();
  await menu.getByRole("menuitem", { name: "Copy page contents" }).click();
  await expect
    .poll(() => authorPage.evaluate(() => navigator.clipboard.readText()))
    .toBe(`# ${first.title}\n\n## Heading\n\nPage menu body`);
  await authorPage.goto(second.path);
  await more(authorPage).click();
  await expect(menu.getByRole("menuitemcheckbox", { name: "Full width" })).not.toBeChecked();
});

test("mobile dark menu retains existing actions and handles clipboard/storage failures", async ({
  authorPage,
}) => {
  const source = await createPage(authorPage, "Menu mobile");
  await authorPage.setViewportSize({ width: 390, height: 844 });
  await authorPage.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("Denied")) },
    });
    Storage.prototype.setItem = () => {
      throw new Error("Storage disabled");
    };
  });
  await authorPage.goto(source.path);
  await more(authorPage).click();
  await expect(authorPage.getByRole("menuitem", { name: "Edit", exact: true })).toBeVisible();
  await expect(authorPage.getByRole("menuitem", { name: "Share", exact: true })).toBeVisible();
  await authorPage.screenshot({
    path: test.info().outputPath("mobile-dark-menu.png"),
    animations: "disabled",
  });
  await authorPage.getByRole("menuitemcheckbox", { name: "Small text" }).click();
  await expect(authorPage.locator("article")).toHaveAttribute("data-small-text", "true");
  await authorPage.getByRole("menuitem", { name: "Copy link", exact: true }).click();
  await expect(authorPage.getByText("Could not copy", { exact: true }).last()).toBeVisible();
});

test("duplicates a subtree, moves it using search, and archives it with restoration available", async ({
  authorPage,
}) => {
  test.setTimeout(90_000);
  const source = await createPage(authorPage, "Menu source");
  const child = await createPage(authorPage, "Menu child");
  const destination = await createPage(authorPage, "Menu destination");
  expect(
    (
      await authorPage.request.post("/api/pages/reorder", {
        data: { pageId: child.id, newParentId: source.id, insertAfterId: null },
      })
    ).ok(),
  ).toBeTruthy();
  await authorPage.goto(source.path);
  await more(authorPage).click();
  await authorPage.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  await expect(authorPage).toHaveURL(/-copy-/);
  const copiedPath = new URL(authorPage.url()).pathname;
  await expect(authorPage.getByRole("heading", { level: 1 })).toHaveText(`${source.title} コピー`, {
    timeout: 15_000,
  });
  await more(authorPage).click();
  await authorPage.getByRole("menuitem", { name: "Move to", exact: true }).click();
  await authorPage.getByRole("textbox", { name: "Search pages" }).fill(destination.title);
  await authorPage
    .getByRole("dialog")
    .getByRole("button", { name: new RegExp(destination.title) })
    .click();
  await expect(authorPage).toHaveURL(
    new RegExp(`${destination.path}${copiedPath.replace("/wiki", "")}`),
  );
  const movedPath = new URL(authorPage.url()).pathname;
  await more(authorPage).click();
  await authorPage.getByRole("menuitem", { name: "Move to Trash" }).click();
  await authorPage
    .getByRole("alertdialog")
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await expect(authorPage).toHaveURL(/\/$/);
  expect((await authorPage.request.get(movedPath)).status()).toBe(404);
  await authorPage.goto("/archived");
  const archivedTitle = authorPage.getByText(`${source.title} (Copy)`, { exact: true });
  await expect(archivedTitle).toBeVisible();
  await archivedTitle
    .locator("../..")
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  await expect(archivedTitle).not.toBeVisible();
  await authorPage.goto(movedPath);
  await expect(authorPage.getByRole("heading", { level: 1 })).toHaveText(`${source.title} コピー`);
});

test("read-only viewers can copy and change display but cannot mutate", async ({
  authorPage,
  memberPage,
}) => {
  const source = await createPage(authorPage, "Menu public");
  expect(
    (
      await authorPage.request.post(`/api/page-access/${source.id}`, {
        data: { intent: "setGeneralAccess", visibility: "public", generalRole: "viewer" },
      })
    ).ok(),
  ).toBeTruthy();
  await memberPage.goto(source.path);
  await more(memberPage).click();
  for (const name of ["Duplicate", "Move to", "Move to Trash"]) {
    await expect(memberPage.getByRole("menuitem", { name, exact: true })).toBeDisabled();
  }
  await memberPage.getByRole("menuitemcheckbox", { name: "Small text" }).click();
  await expect(memberPage.locator("article")).toHaveAttribute("data-small-text", "true");
  expect(
    (await memberPage.request.post(source.path, { form: { intent: "duplicatePage" } })).status(),
  ).toBe(403);
  expect(
    (await memberPage.request.get(`/api/pages/move-targets?pageId=${source.id}`)).status(),
  ).toBe(403);
});

test("display settings stay separate for another user and anonymous readers", async ({
  authorPage,
  memberPage,
}) => {
  const source = await createPage(authorPage, "Menu identity");
  await authorPage.request.post(`/api/page-access/${source.id}`, {
    data: { intent: "setGeneralAccess", visibility: "public", generalRole: "viewer" },
  });
  await authorPage.goto(source.path);
  await more(authorPage).click();
  await authorPage.getByRole("menuitemcheckbox", { name: "Small text" }).click();
  await expect(authorPage.locator("article")).toHaveAttribute("data-small-text", "true");
  await authorPage.context().clearCookies();
  await authorPage.context().addCookies(await memberPage.context().cookies());
  await authorPage.reload();
  await expect(authorPage.locator("article")).toHaveAttribute("data-small-text", "false");
  await more(authorPage).click();
  await authorPage.getByRole("menuitemcheckbox", { name: "Small text" }).click();
  await authorPage.context().clearCookies();
  await authorPage.reload();
  await expect(authorPage.locator("article")).toHaveAttribute("data-small-text", "false");
});

test("Markdown copy uses the redacted displayed content and language fallback", async ({
  authorPage,
}) => {
  await authorPage.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const source = await createPage(
    authorPage,
    "Menu redacted",
    'Visible\n\n<acl level="organizer">PRIVATE_SECRET</acl>',
    "",
  );
  await authorPage.goto(`${source.path}?lang=en`);
  await expect(authorPage.locator("article")).not.toContainText("PRIVATE_SECRET");
  await more(authorPage).click();
  await authorPage.getByRole("menuitem", { name: "Copy page contents" }).click();
  await expect
    .poll(() => authorPage.evaluate(() => navigator.clipboard.readText()))
    .toContain("Visible");
  const copied = await authorPage.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Visible");
  expect(copied).not.toContain("PRIVATE_SECRET");
  expect(copied).not.toContain("<acl");
});
