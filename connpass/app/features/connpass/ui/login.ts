import type { Page } from "@cloudflare/playwright";
import { emptyPlaceholders, selectors } from "./selectors";

export async function loginWithPassword(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto("https://connpass.com/login/", { waitUntil: "domcontentloaded" });
  await page.locator(selectors.login.username).fill(credentials.email);
  await page.locator(selectors.login.password).fill(credentials.password);
  await Promise.all([
    page
      .waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 })
      .catch(() => undefined),
    page.locator(selectors.login.submit).click(),
  ]);
  if (page.url().includes("/login")) {
    throw new Error("connpass_login_failed");
  }
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  await page.goto("https://connpass.com/dashboard/", {
    waitUntil: "domcontentloaded",
  });
  return !page.url().includes("/login");
}

export function readableText(raw: string | null | undefined): string {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if ((emptyPlaceholders as readonly string[]).includes(text)) return "";
  if (text.startsWith("(") && text.endsWith(")") && text.includes("クリック")) return "";
  return text;
}
