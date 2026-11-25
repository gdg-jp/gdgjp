import type { Page } from "@cloudflare/playwright";
import { htmlTokens } from "@gdgjp/gdg-lib/html";

export type CheckinUrl = { url: string; eventId: string };

const CHECKIN_PATH = /^\/event\/(\d+)\/qr_checkin\/\d+\/\d+\/?$/;

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

export type CheckinReason = "already_checked_in" | "failed";
export type CheckinResult = {
  checkedIn: boolean;
  userId: string | null;
  reason: CheckinReason | null;
};

const CHECKIN_ALREADY =
  /(すでに|既に|もう).{0,20}(受付|出席|チェックイン)|受付済|チェックイン済|出席済/;
const CHECKIN_SUCCESS =
  /受付(が|を)?(完了|しました)|出席(登録|に)|チェックイン(が|を)?(完了|しました)/;
const CHECKIN_FAILURE = /(無効|見つかりません|権限|エラー|失敗|できません)/;
const USER_LINK = /href="(?:https:\/\/connpass\.com)?\/user\/([^/"?#]+)\/?"/;
const ATTENDEE_LINK =
  /参加者[\s\S]{0,400}?href="(?:https:\/\/connpass\.com)?\/user\/([^/"?#]+)\/?"/;

const OUTSIDE_MAIN = ["header", "nav", "footer", "script", "style"];

export function parseCheckinPage(html: string): CheckinResult {
  const tokens = htmlTokens(html, { skip: OUTSIDE_MAIN });
  const main = tokens.map((token) => (token.kind === "text" ? token.text : token.source)).join("");
  const text = tokens
    .map((token) => (token.kind === "text" ? token.text : " "))
    .join("")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
  const userId = (ATTENDEE_LINK.exec(main) ?? USER_LINK.exec(main))?.[1] ?? null;
  // "既に出席済です" is rendered under an "イベント出席エラー" heading, so check it before failure.
  if (CHECKIN_ALREADY.test(text)) return { checkedIn: false, userId, reason: "already_checked_in" };
  if (CHECKIN_SUCCESS.test(text)) return { checkedIn: true, userId, reason: null };
  if (CHECKIN_FAILURE.test(text)) return { checkedIn: false, userId, reason: "failed" };
  return { checkedIn: false, userId, reason: "failed" };
}

export async function checkInWithQrUrl(page: Page, checkinUrl: string): Promise<CheckinResult> {
  await page.route("**/*", (route) =>
    ["image", "font", "media", "stylesheet"].includes(route.request().resourceType())
      ? route.abort()
      : route.continue(),
  );
  const response = await page.goto(checkinUrl, { waitUntil: "domcontentloaded" });
  if (page.url().includes("/login")) throw new Error("connpass_login_required");
  if (!response?.ok()) return { checkedIn: false, userId: null, reason: "failed" };
  return parseCheckinPage(await page.content());
}
