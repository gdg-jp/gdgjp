import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installSignedOutReload } from "./signed-out-reload";

type Me = { user: unknown } | "error";

function fakeWindow(me: Me, apiStatus = 401) {
  const storage = new Map<string, string>();
  const reload = vi.fn();
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/auth/me") {
      return me === "error" ? new Response("", { status: 503 }) : Response.json(me);
    }
    return new Response("", { status: apiStatus });
  });
  const win = {
    fetch,
    location: { href: "https://app.gdgs.jp/dashboard", origin: "https://app.gdgs.jp", reload },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  };
  vi.stubGlobal("window", win);
  return { win, fetch, reload };
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("installSignedOutReload", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("reloads once when a 401 coincides with a signed-out session", async () => {
    const { win, reload } = fakeWindow({ user: null });
    installSignedOutReload();

    await win.fetch("/api/images");
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);

    // The same location never reloads twice (public pages may keep 401ing).
    await win.fetch("/api/images");
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps the page when the session is still valid (an API-specific 401)", async () => {
    const { win, reload } = fakeWindow({ user: { id: "u" } });
    installSignedOutReload();

    await win.fetch("/api/google-documents/picker-token");
    await settle();
    expect(reload).not.toHaveBeenCalled();
  });

  it("ignores other statuses, other origins, auth endpoints and an unavailable IdP", async () => {
    const ok = fakeWindow({ user: null }, 200);
    installSignedOutReload();
    await ok.win.fetch("/api/images");
    await settle();
    expect(ok.fetch).toHaveBeenCalledTimes(1);

    const cross = fakeWindow({ user: null });
    installSignedOutReload();
    await cross.win.fetch("https://other.example/api");
    await cross.win.fetch("/api/auth/signout");
    await settle();
    expect(cross.reload).not.toHaveBeenCalled();

    const down = fakeWindow("error");
    installSignedOutReload();
    await down.win.fetch("/api/images");
    await settle();
    expect(down.reload).not.toHaveBeenCalled();
  });
});
