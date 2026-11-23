import { parseCookies, serializeCookie } from "@gdgjp/gdg-lib";

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

export function ensureVoterId(
  request: Request,
  opts: { secure: boolean },
): { id: string; setCookie?: string } {
  const existing = readVoterId(request);
  if (existing) return { id: existing };
  const id = crypto.randomUUID();
  return { id, setCookie: serializeVoterCookie(id, opts) };
}
