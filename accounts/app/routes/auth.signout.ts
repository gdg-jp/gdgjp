import { getAuth } from "~/lib/auth.server";
import type { Route } from "./+types/auth.signout";

function originsFromCsv(csv: string | undefined, source: string): string[] {
  if (!csv) return [];
  const out: string[] = [];
  for (const raw of csv.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      console.error("auth.signout: ignoring malformed RP redirect URL", { source, value: trimmed });
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      console.error("auth.signout: ignoring RP redirect URL with non-http(s) protocol", {
        source,
        value: trimmed,
        protocol: url.protocol,
      });
      continue;
    }
    if (url.origin === "null") {
      console.error("auth.signout: ignoring RP redirect URL with null origin", {
        source,
        value: trimmed,
      });
      continue;
    }
    out.push(url.origin);
  }
  return out;
}

function rpOrigins(env: Env): string[] {
  const set = new Set<string>();
  for (const o of originsFromCsv(env.TINYURL_REDIRECT_URLS, "TINYURL_REDIRECT_URLS")) set.add(o);
  for (const o of originsFromCsv(env.WIKI_REDIRECT_URLS, "WIKI_REDIRECT_URLS")) set.add(o);
  for (const o of originsFromCsv(env.IMG_REDIRECT_URLS, "IMG_REDIRECT_URLS")) set.add(o);
  return [...set];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  return getAuth(env).handleFederatedSignOut(request, { rpOrigins: rpOrigins(env) });
}
