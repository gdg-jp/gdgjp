import { redirect } from "react-router";

export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  // Allow relative paths
  if (value.startsWith("/") && !value.startsWith("//")) {
    if (value.includes("\\") || value.includes("\r") || value.includes("\n")) return null;
    return value;
  }
  // Allow absolute HTTPS URLs on trusted gdgs.jp origins (sibling apps)
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      (url.hostname === "gdgs.jp" || url.hostname.endsWith(".gdgs.jp"))
    ) {
      return value;
    }
  } catch {
    // ignore invalid URLs
  }
  return null;
}

/**
 * Continue an OAuth authorization request after the Accounts session has been
 * established. The provider sends unauthenticated authorization requests to
 * `/signin` with the original query parameters, so sending an already signed-in
 * user to the dashboard here would abandon the relying-party login entirely.
 */
export function signedInDestination(searchParams: URLSearchParams): string {
  if (searchParams.has("client_id")) {
    return `/api/auth/oauth2/authorize?${searchParams.toString()}`;
  }
  return safeReturnTo(searchParams.get("return_to")) ?? "/dashboard";
}

export function buildSignInRedirect(request: Request): Response {
  const url = new URL(request.url);
  const returnTo = url.pathname + url.search;
  return redirect(`/signin?return_to=${encodeURIComponent(returnTo)}`);
}
