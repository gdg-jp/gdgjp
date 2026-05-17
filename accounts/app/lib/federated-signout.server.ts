// Federated sign-out page: renders an HTML page with one hidden iframe per RP
// pointing at /auth/signout-iframe, then redirects the browser back to the
// return_to URL once all iframes have settled (or after a timeout).

import { clearIdpSessionCookie } from "./idp-session.server";

export interface FederatedSignOutOptions {
  rpOrigins: string[];
  iframePath?: string;
  fallbackReturnTo?: string;
  timeoutMs?: number;
}

export function handleFederatedSignOut(
  request: Request,
  appUrl: string,
  options: FederatedSignOutOptions,
): Response {
  const iframePath = options.iframePath ?? "/auth/signout-iframe";
  const fallbackReturnTo = options.fallbackReturnTo ?? "/signin";
  const timeoutMs = options.timeoutMs ?? 3000;

  const url = new URL(request.url);
  const target = safeReturnTo(
    url.searchParams.get("return_to") ?? fallbackReturnTo,
    appUrl,
    options.rpOrigins,
    fallbackReturnTo,
  );

  const iframeUrls = options.rpOrigins.map((origin) => `${origin}${iframePath}`);
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Set-Cookie": clearIdpSessionCookie(),
  });
  return new Response(renderFederatedSignOutPage(iframeUrls, target, timeoutMs), {
    status: 200,
    headers,
  });
}

function safeReturnTo(
  returnTo: string,
  appUrl: string,
  rpOrigins: string[],
  fallbackPath: string,
): string {
  try {
    const url = new URL(returnTo, appUrl);
    const selfOrigin = new URL(appUrl).origin;
    if (url.origin === selfOrigin || rpOrigins.includes(url.origin)) return url.toString();
  } catch {}
  return new URL(fallbackPath, appUrl).toString();
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function renderFederatedSignOutPage(
  iframeUrls: string[],
  target: string,
  timeoutMs: number,
): string {
  const iframes = iframeUrls
    .map(
      (u) =>
        `<iframe src="${escapeHtml(u)}" referrerpolicy="no-referrer" style="display:none" aria-hidden="true"></iframe>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Signing out…</title>
<meta name="robots" content="noindex" />
</head>
<body>
<p>Signing out…</p>
${iframes}
<script>
(function () {
  var done = false;
  var target = ${JSON.stringify(target)};
  var total = ${iframeUrls.length};
  var loaded = 0;
  function go() { if (done) return; done = true; window.location.replace(target); }
  if (total === 0) { go(); return; }
  document.querySelectorAll('iframe').forEach(function (f) {
    var settle = function () { loaded += 1; if (loaded >= total) go(); };
    f.addEventListener('load', settle, { once: true });
    f.addEventListener('error', settle, { once: true });
  });
  setTimeout(go, ${timeoutMs});
})();
</script>
</body>
</html>`;
}
