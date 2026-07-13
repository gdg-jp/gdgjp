import type { Link } from "./db";
import { parseUA } from "./ua-parse";

const SOURCE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function sourceFromRequest(request: Request): string {
  const values = new URL(request.url).searchParams.getAll("s");
  if (values.length !== 1) return "";
  const source = values[0].trim().toLowerCase();
  return SOURCE_RE.test(source) ? source : "";
}

export function writeClickEvent(env: Env, request: Request, link: Link): void {
  if (!env.CLICKS_AE) return;
  const cf = (request as Request & { cf?: Record<string, string> }).cf ?? {};
  const ua = request.headers.get("user-agent");
  const { browser, os, device } = parseUA(ua);
  const refererOrigin = getRefererOrigin(request.headers.get("referer"));
  const country = cf.country ?? "";
  const region = cf.region ?? "";
  const city = cf.city ?? "";
  const continent = cf.continent ?? "";
  const source = sourceFromRequest(request);

  env.CLICKS_AE.writeDataPoint({
    blobs: [
      link.slug,
      country,
      region,
      city,
      continent,
      refererOrigin,
      browser,
      os,
      device,
      source,
    ],
    indexes: [link.id],
  });
}

function getRefererOrigin(referer: string | null): string {
  if (!referer) return "";
  try {
    return new URL(referer).origin;
  } catch {
    return "";
  }
}
