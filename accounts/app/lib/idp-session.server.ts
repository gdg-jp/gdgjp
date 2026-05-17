// IdP login session — a signed cookie carrying { userId, exp }.
// Replaces better-auth's session table for the IdP login UI.

import {
  clearedCookie,
  readCookie,
  serializeCookie,
  signPayload,
  verifyPayload,
} from "@gdgjp/gdg-lib";

const COOKIE_NAME = "gdgjp-accounts-session";
const MAX_AGE_S = 60 * 60 * 24 * 14; // 14 days

interface IdpSessionPayload {
  userId: string;
  email: string;
  isAdmin: boolean;
  exp: number;
}

export async function readIdpSession(
  request: Request,
  secret: string,
): Promise<IdpSessionPayload | null> {
  const value = readCookie(request, COOKIE_NAME);
  if (!value) return null;
  const payload = await verifyPayload<IdpSessionPayload>(value, secret);
  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export async function buildIdpSessionCookie(
  session: { userId: string; email: string; isAdmin: boolean },
  secret: string,
  appUrl: string,
): Promise<string> {
  const payload: IdpSessionPayload = {
    ...session,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_S,
  };
  return serializeCookie({
    name: COOKIE_NAME,
    value: await signPayload(payload, secret),
    maxAge: MAX_AGE_S,
    secure: !isLocalAppUrl(appUrl),
  });
}

export function clearIdpSessionCookie(): string {
  return clearedCookie(COOKIE_NAME);
}

function isLocalAppUrl(appUrl: string): boolean {
  try {
    const u = new URL(appUrl);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}
