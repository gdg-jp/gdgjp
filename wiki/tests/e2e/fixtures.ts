import path from "node:path";
import { type Browser, type Page, test as base } from "@playwright/test";

const storageDir = path.join(__dirname, "storage-state");

async function newPageWithAuth(browser: Browser, storageFile: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState: path.join(storageDir, storageFile) });
  return ctx.newPage();
}

export const test = base.extend<{
  adminPage: Page;
  authorPage: Page;
  memberPage: Page;
}>({
  adminPage: async ({ browser }, use) => {
    const page = await newPageWithAuth(browser, "admin.json");
    await use(page);
    await page.context().close();
  },
  authorPage: async ({ browser }, use) => {
    const page = await newPageWithAuth(browser, "author.json");
    await use(page);
    await page.context().close();
  },
  memberPage: async ({ browser }, use) => {
    const page = await newPageWithAuth(browser, "member.json");
    await use(page);
    await page.context().close();
  },
});

export { expect } from "@playwright/test";
