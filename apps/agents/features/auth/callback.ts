import { completeAccountLink } from "./authorization";
import type { LinkAccountDeps } from "./contracts";
import { linkAccountDepsFromEnv } from "./environment";
/**
 * HTTP handler for `GET /auth/callback`.
 * Query params other than `code` / `state` are ignored — do not log the URL.
 */
export async function handleAuthCallback(
  request: Request,
  deps: LinkAccountDeps = linkAccountDepsFromEnv(),
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return authCallbackHtml(400, "Linking was cancelled or denied.");
  }

  if (!code || !state) {
    return authCallbackHtml(400, "Missing authorization response.");
  }

  // Intentionally ignore chatUserId / platform query params — binding is Redis state only.
  const result = await completeAccountLink({ code, state }, deps);

  if (!result.ok) {
    // invalid_state covers unknown, expired, and already-consumed state — no token exchange.
    return authCallbackHtml(400, "This linking link is invalid or has already been used.");
  }

  return authCallbackHtml(
    200,
    "Your Chat account is now linked to GDG Accounts. You can close this window and return to Chat.",
  );
}

function authCallbackHtml(status: number, message: string): Response {
  const title = status === 200 ? "Account linked" : "Linking failed";
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; color: #111; }
    h1 { font-size: 1.25rem; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>${message}</p>
</body>
</html>`;
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
