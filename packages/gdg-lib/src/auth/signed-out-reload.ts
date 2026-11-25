import { useMountEffect } from "../react/mount-effect";

const RELOADED_KEY = "gdg-signed-out-reload";

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
  const here = window.location.href;
  try {
    if (window.sessionStorage.getItem(RELOADED_KEY) === here) return;
    window.sessionStorage.setItem(RELOADED_KEY, here);
  } catch {}
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

export function useSignedOutReload(): void {
  useMountEffect(installSignedOutReload);
}
