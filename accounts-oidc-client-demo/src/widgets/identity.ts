import type { Session } from "../auth/session";
import { escapeHtml } from "../components/document";

export function configurationContent(request: Request): string {
  const origin = new URL(request.url).origin;
  return `<p class="error">This Worker is not configured with OIDC client credentials yet.</p>
<p>Register these values in GDG Accounts, then set the Worker secrets:</p>
<ul><li>Redirect URI: <code>${escapeHtml(`${origin}/auth/callback`)}</code></li>
<li>Post-logout redirect URI: <code>${escapeHtml(`${origin}/`)}</code></li></ul>`;
}

export function authenticatedContent(session: Session): string {
  const claims: Record<string, unknown> = { sub: session.sub, ...session.claims };
  const picture =
    typeof claims.picture === "string" ? `<img src="${escapeHtml(claims.picture)}" alt="" />` : "";
  return `${picture}<p>You are signed in with GDG Accounts.</p><dl>${Object.entries(claims)
    .filter(([key]) => key !== "picture")
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatClaim(value))}</dd>`)
    .join("")}</dl><p><a class="button" href="/auth/logout">Log out</a></p>`;
}

function formatClaim(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
