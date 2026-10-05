import type { Session } from "../auth/session";
import { escapeHtml, page } from "../components/document";
import { html } from "../platform/http";
import { authenticatedContent, configurationContent } from "../widgets/identity";

const TITLE = "GDG Accounts OIDC Client Demo";

export function renderHome(
  request: Request,
  configured: boolean,
  session: Session | null,
  status = 200,
): Response {
  return html(
    page(
      session
        ? authenticatedContent(session)
        : configured
          ? '<p>You are not signed in.</p><p><a class="button" href="/auth/login">Log in with GDG Accounts</a></p>'
          : configurationContent(request),
      TITLE,
    ),
    status,
  );
}

export function loginFailure(message: string, cookie: string, status = 400): Response {
  return html(
    page(`<p class="error">${escapeHtml(message)}</p><p><a href="/">Return home</a></p>`, TITLE),
    status,
    {
      "Set-Cookie": cookie,
    },
  );
}
