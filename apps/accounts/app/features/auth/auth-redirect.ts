import { safeReturnTo } from "@gdgjp/gdg-lib/auth/return-to";
import { redirect } from "react-router";

export function signedInDestination(url: URL): string {
  if (url.searchParams.has("client_id")) {
    return `/api/auth/oauth2/authorize?${url.searchParams.toString()}`;
  }
  return safeReturnTo(url.searchParams.get("return_to"), url.origin) ?? "/dashboard";
}

export function buildSignInRedirect(request: Request): Response {
  const url = new URL(request.url);
  const returnTo = url.pathname + url.search;
  return redirect(`/signin?return_to=${encodeURIComponent(returnTo)}`);
}
