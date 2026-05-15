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
  for (const o of originsFromCsv(env.SCHEDULER_REDIRECT_URLS, "SCHEDULER_REDIRECT_URLS"))
    set.add(o);
  return [...set];
}

function clientSecrets(env: Env): Map<string, string> {
  const m = new Map<string, string>();
  if (env.TINYURL_CLIENT_ID && env.TINYURL_CLIENT_SECRET)
    m.set(env.TINYURL_CLIENT_ID, env.TINYURL_CLIENT_SECRET);
  if (env.WIKI_CLIENT_ID && env.WIKI_CLIENT_SECRET)
    m.set(env.WIKI_CLIENT_ID, env.WIKI_CLIENT_SECRET);
  if (env.IMG_CLIENT_ID && env.IMG_CLIENT_SECRET) m.set(env.IMG_CLIENT_ID, env.IMG_CLIENT_SECRET);
  if (env.SCHEDULER_CLIENT_ID && env.SCHEDULER_CLIENT_SECRET)
    m.set(env.SCHEDULER_CLIENT_ID, env.SCHEDULER_CLIENT_SECRET);
  return m;
}

function b64uToBytes(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = (s + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function verifyIdTokenHint(
  token: string,
  clientId: string,
  secret: string,
): Promise<{ sub: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  let header: { alg?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64uToBytes(headerB64)));
    payload = JSON.parse(new TextDecoder().decode(b64uToBytes(payloadB64)));
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    b64uToBytes(sigB64) as BufferSource,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`) as BufferSource,
  );
  if (!ok) return null;
  if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp + 60) return null;
  if (typeof payload.sub !== "string") return null;
  const aud = payload.aud;
  const audOk =
    typeof aud === "string" ? aud === clientId : Array.isArray(aud) && aud.includes(clientId);
  if (!audOk) return null;
  return { sub: payload.sub };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const auth = getAuth(env);
  const url = new URL(request.url);
  const idTokenHint = url.searchParams.get("id_token_hint");
  const clientId = url.searchParams.get("client_id");

  if (idTokenHint && clientId) {
    const secret = clientSecrets(env).get(clientId);
    if (!secret) {
      console.error("auth.signout: unknown client_id in id_token_hint flow", { clientId });
      return new Response("invalid_request: unknown client_id", { status: 400 });
    }
    const verified = await verifyIdTokenHint(idTokenHint, clientId, secret);
    if (!verified) {
      console.error("auth.signout: id_token_hint failed verification", { clientId });
      return new Response("invalid_request: id_token_hint invalid", { status: 400 });
    }
    const sessionUser = await auth.getSessionUser(request);
    if (sessionUser && sessionUser.id !== verified.sub) {
      console.error("auth.signout: id_token_hint sub does not match session user", {
        clientId,
        hintSub: verified.sub,
        sessionUserId: sessionUser.id,
      });
      return new Response("invalid_request: id_token_hint subject mismatch", { status: 400 });
    }
  } else if (!idTokenHint) {
    console.warn("auth.signout: missing id_token_hint; proceeding without CSRF binding", {
      url: request.url,
    });
  }

  return auth.handleFederatedSignOut(request, { rpOrigins: rpOrigins(env) });
}
