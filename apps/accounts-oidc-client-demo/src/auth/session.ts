import { readEncryptedCookie } from "../platform/cookies";
import type { Env } from "./config";

export const SESSION_COOKIE = "gdgjp-oidc-demo-session";
export const SESSION_MAX_AGE_S = 60 * 60 * 8;

export type Session = {
  claims: Record<string, unknown>;
  exp: number;
  idToken: string;
  issuer: string;
  sub: string;
};

export async function readSession(request: Request, env: Env): Promise<Session | null> {
  const session = await readEncryptedCookie<Session>(
    request,
    SESSION_COOKIE,
    env.SESSION_SECRET as string,
  );
  return isSession(session, env.IDP_ISSUER) ? session : null;
}

function isSession(value: Session | null, issuer: string): value is Session {
  return Boolean(
    value &&
      typeof value.idToken === "string" &&
      typeof value.issuer === "string" &&
      value.issuer === issuer &&
      typeof value.sub === "string" &&
      typeof value.exp === "number" &&
      value.exp > Date.now() &&
      value.claims &&
      typeof value.claims === "object",
  );
}
