import type { AuthUser } from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { getAuth } from "~/lib/auth.server";

export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export function buildSignInRedirect(request: Request): Response {
  const url = new URL(request.url);
  const target = `${url.pathname}${url.search}`;
  return redirect(`/signin?return_to=${encodeURIComponent(target)}`);
}

export async function requireUser(env: Env, request: Request): Promise<AuthUser> {
  try {
    return await getAuth(env).requireUser(request);
  } catch (e) {
    if (e instanceof Response && e.status === 401) throw buildSignInRedirect(request);
    throw e;
  }
}

export async function getOptionalUser(env: Env, request: Request): Promise<AuthUser | null> {
  return getAuth(env).getSessionUser(request);
}
