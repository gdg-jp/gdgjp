import { parseCookies, serializeCookie } from "@gdgjp/gdg-lib";

/**
 * Anonymous per-browser voter identity for participant pages.
 *
 * Not authenticated — bypassable by clearing cookies / incognito, and shared by
 * everyone using the same device. That is acceptable for an in-room OST vote.
 */
export const VOTER_COOKIE = "ost-voter";

const ONE_YEAR_S = 60 * 60 * 24 * 365;

export function readVoterId(request: Request): string | null {
  return parseCookies(request.headers.get("cookie"))[VOTER_COOKIE] ?? null;
}

export function serializeVoterCookie(id: string, opts: { secure: boolean }): string {
  return serializeCookie({
    name: VOTER_COOKIE,
    value: id,
    path: "/",
    maxAge: ONE_YEAR_S,
    httpOnly: true,
    sameSite: "Lax",
    secure: opts.secure,
  });
}

/**
 * Return the request's voter id, minting one when absent. `setCookie` is only
 * present when a fresh id was generated and must be echoed on the response.
 */
export function ensureVoterId(
  request: Request,
  opts: { secure: boolean },
): { id: string; setCookie?: string } {
  const existing = readVoterId(request);
  if (existing) return { id: existing };
  const id = crypto.randomUUID();
  return { id, setCookie: serializeVoterCookie(id, opts) };
}
