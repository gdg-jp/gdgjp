export type LumaCheckinUrl = { eventApiId: string; proxyKey: string };

const CHECKIN_PATH = /^\/check-in\/(evt-[A-Za-z0-9]+)\/?$/;
const PROXY_KEY = /^g-[A-Za-z0-9]+$/;
const HOSTS = new Set(["luma.com", "lu.ma"]);

export function parseLumaCheckinUrl(raw: unknown): LumaCheckinUrl | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname)) return null;
  if (url.username || url.password || url.port) return null;
  const eventApiId = CHECKIN_PATH.exec(url.pathname)?.[1];
  const proxyKey = url.searchParams.get("pk");
  if (!eventApiId || !proxyKey || !PROXY_KEY.test(proxyKey)) return null;
  return { eventApiId, proxyKey };
}
