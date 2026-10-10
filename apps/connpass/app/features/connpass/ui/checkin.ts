import type { Page } from "@cloudflare/playwright";
import { parseEventModel } from "./event-model";
import { eventEditUrl } from "./urls";

export type CheckinUrl = { url: string; eventId: string };

const CHECKIN_PATH = /^\/event\/(\d+)\/qr_checkin\/\d+\/\d+\/?$/;

/**
 * Accept only connpass reception QR URLs
 * (`https://connpass.com/event/<eventId>/qr_checkin/<n>/<n>/`) so the bot never
 * navigates to an arbitrary caller-supplied address.
 */
export function parseCheckinUrl(raw: unknown): CheckinUrl | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "connpass.com") return null;
  if (url.username || url.password || url.port) return null;
  const match = CHECKIN_PATH.exec(url.pathname);
  if (!match?.[1]) return null;
  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return { url: `https://connpass.com${path}`, eventId: match[1] };
}

/** Numeric connpass group (series) id of an event, read from its edit page model. */
export async function scrapeEventGroupNumericId(
  page: Page,
  eventId: string,
): Promise<number | null> {
  await page.goto(eventEditUrl(eventId), { waitUntil: "domcontentloaded" });
  if (page.url().includes("/login")) throw new Error("connpass_login_required");
  return parseEventModel(await page.content())?.series ?? null;
}

const CHECKIN_SUCCESS =
  /受付(が|を)?(完了|しました)|受付済|出席(登録|に)|チェックイン(が|を)?(完了|しました)|チェックイン済/;
const CHECKIN_FAILURE = /(無効|見つかりません|権限|エラー|失敗|できません)/;

/**
 * Open the reception QR URL as the bot (a co-admin of the event), which is all
 * connpass needs to mark the participant as attended. Reports success only when
 * the resulting page affirms the check-in.
 */
export async function checkInWithQrUrl(page: Page, checkinUrl: string): Promise<boolean> {
  const response = await page.goto(checkinUrl, { waitUntil: "domcontentloaded" });
  if (page.url().includes("/login")) throw new Error("connpass_login_required");
  if (!response?.ok()) return false;
  const text = (
    await page
      .locator("body")
      .innerText()
      .catch(() => "")
  ).replace(/\s+/g, " ");
  return CHECKIN_SUCCESS.test(text) && !CHECKIN_FAILURE.test(text);
}
