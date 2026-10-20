// Client-only: reloads the page when an in-page API call reveals that the
// accounts.gdgs.jp session ended (signed out, switched account, revoked).
//
// Navigations already redirect through sign-in on the server. Raw `fetch`
// calls cannot follow that redirect, and some APIs answer 401 for their own
// reasons (an unconnected integration), so a 401 alone is not proof. Ask the
// RP's `/api/auth/me` instead, and reload only when it says nobody is signed
// in: the reloaded page then goes through the normal sign-in redirect.

const RELOADED_KEY = "gdg-signed-out-reload";

/** Install once from the app root (in an effect); returns an uninstaller. */
export function installSignedOutReload(): () => void {
  if (typeof window === "undefined") return () => {};
  const original = window.fetch.bind(window);
  let checking = false;

  const patched: typeof fetch = async (input, init) => {
    const response = await original(input, init);
    if (response.status === 401 && !checking && isSameOriginApi(input)) {
      checking = true;
      void reloadIfSignedOut(original).finally(() => {
        checking = false;
      });
    }
    return response;
  };
  window.fetch = patched;
  return () => {
    if (window.fetch === patched) window.fetch = original;
  };
}

async function reloadIfSignedOut(originalFetch: typeof fetch): Promise<void> {
  try {
    const response = await originalFetch("/api/auth/me", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return;
    const body = (await response.json()) as { user?: unknown };
    if (body.user !== null) return;
  } catch {
    return;
  }
  // A public page whose API keeps answering 401 to signed-out visitors must
  // not reload forever: reload once per location.
  const here = window.location.href;
  try {
    if (window.sessionStorage.getItem(RELOADED_KEY) === here) return;
    window.sessionStorage.setItem(RELOADED_KEY, here);
  } catch {
    // Storage unavailable: still reload once for this page instance.
  }
  window.location.reload();
}

function isSameOriginApi(input: RequestInfo | URL): boolean {
  let url: URL;
  try {
    const raw = input instanceof Request ? input.url : String(input);
    url = new URL(raw, window.location.href);
  } catch {
    return false;
  }
  return url.origin === window.location.origin && !url.pathname.startsWith("/api/auth/");
}
