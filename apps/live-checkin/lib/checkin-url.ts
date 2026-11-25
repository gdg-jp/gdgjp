export type CheckInTarget =
  | { kind: "connpass"; eventId: string; url: string }
  | { kind: "luma"; url: string };

const CONNPASS_PATH = /^\/event\/(\d+)\/qr_checkin\/(\d+)\/(\d+)\/?$/;
const LUMA_PATH = /^\/check-in\/(evt-[A-Za-z0-9]+)\/?$/;
const LUMA_PROXY_KEY = /^g-[A-Za-z0-9]+$/;
const LUMA_HOSTS = new Set(["luma.com", "lu.ma"]);

export function parseCheckInUrl(raw: unknown): CheckInTarget | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;

  if (url.hostname === "connpass.com") {
    const match = CONNPASS_PATH.exec(url.pathname);
    if (!match || url.search || url.hash) return null;
    const [, eventId, first, second] = match;
    return {
      kind: "connpass",
      eventId,
      url: `https://connpass.com/event/${eventId}/qr_checkin/${first}/${second}/`,
    };
  }

  if (LUMA_HOSTS.has(url.hostname)) {
    const eventApiId = LUMA_PATH.exec(url.pathname)?.[1];
    const proxyKey = url.searchParams.get("pk");
    if (!eventApiId || !proxyKey || !LUMA_PROXY_KEY.test(proxyKey)) return null;
    return { kind: "luma", url: `https://luma.com/check-in/${eventApiId}?pk=${proxyKey}` };
  }

  return null;
}

export function isCheckInForEvent(target: CheckInTarget, eventId: string): boolean {
  return target.kind === "luma" || target.eventId === eventId;
}
