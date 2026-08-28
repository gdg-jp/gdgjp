import { beforeEach, describe, expect, it, vi } from "vitest";

const pw = vi.hoisted(() => ({
  sessions: vi.fn(),
  connect: vi.fn(),
  launch: vi.fn(),
}));

vi.mock("@cloudflare/playwright", () => ({ ...pw, default: {} }));

const login = vi.hoisted(() => ({
  isLoggedIn: vi.fn(),
  loginWithPassword: vi.fn(),
}));

vi.mock("./connpass-ui/login", () => login);

import { ensureLoggedIn, forceRelogin, openConnpassSession } from "./browser.server";

const STORAGE_KEY = "connpass:bot:storageState";
const CHECKED_KEY = "connpass:bot:sessionCheckedAt";

function makeEnv(): Env {
  const kv = new Map<string, string>();
  return {
    SESSION_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => {
        kv.set(k, v);
      },
      delete: async (k: string) => {
        kv.delete(k);
      },
    },
    BROWSER: { fetch: vi.fn() },
    CONNPASS_BOT_EMAIL: "bot@example.com",
    CONNPASS_BOT_PASSWORD: "secret",
  } as unknown as Env;
}

// biome-ignore lint/suspicious/noExplicitAny: lightweight test doubles
type Any = any;

function makePage(url = "https://connpass.com/dashboard/"): Any {
  return { url: () => url };
}

function makeContext(pages: Any[] = []): Any {
  return {
    pages: () => pages,
    newPage: vi.fn(async () => {
      const p = makePage();
      pages.push(p);
      return p;
    }),
    storageState: vi.fn(async () => ({ cookies: [], origins: [] })),
    newCDPSession: vi.fn(async () => ({ send: vi.fn() })),
  };
}

function makeBrowser(opts: { contexts?: Any[]; sessionId?: string } = {}): Any {
  const contexts = opts.contexts ?? [];
  return {
    contexts: () => contexts,
    newContext: vi.fn(async () => {
      const c = makeContext();
      contexts.push(c);
      return c;
    }),
    sessionId: () => opts.sessionId ?? "sess-new",
    close: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  login.isLoggedIn.mockResolvedValue(true);
  login.loginWithPassword.mockResolvedValue(undefined);
});

describe("openConnpassSession — session reuse", () => {
  it("reuses a free warm session via connect()", async () => {
    const env = makeEnv();
    const page = makePage();
    const ctx = makeContext([page]);
    const browser = makeBrowser({ contexts: [ctx] });
    pw.sessions.mockResolvedValue([{ sessionId: "s1", startTime: 1000 }]);
    pw.connect.mockResolvedValue(browser);

    const session = await openConnpassSession(env);

    expect(pw.connect).toHaveBeenCalledWith(env.BROWSER, "s1");
    expect(pw.launch).not.toHaveBeenCalled();
    expect(session.mode).toBe("connected");
    expect(session.page).toBe(page);
    expect(session.context).toBe(ctx);
  });

  it("picks the newest free session and ignores connected ones", async () => {
    const env = makeEnv();
    const browser = makeBrowser({ contexts: [makeContext([makePage()])] });
    pw.sessions.mockResolvedValue([
      { sessionId: "old", startTime: 10 },
      { sessionId: "busy", startTime: 999, connectionId: "c" },
      { sessionId: "new", startTime: 500 },
    ]);
    pw.connect.mockResolvedValue(browser);

    await openConnpassSession(env);

    expect(pw.connect).toHaveBeenCalledWith(env.BROWSER, "new");
  });

  it("cold-launches with keep_alive when every session is already connected", async () => {
    const env = makeEnv();
    await env.SESSION_KV.put(STORAGE_KEY, JSON.stringify({ cookies: ["x"] }));
    const browser = makeBrowser({ sessionId: "fresh" });
    pw.sessions.mockResolvedValue([{ sessionId: "s1", startTime: 1, connectionId: "c1" }]);
    pw.launch.mockResolvedValue(browser);

    const session = await openConnpassSession(env);

    expect(pw.connect).not.toHaveBeenCalled();
    expect(pw.launch).toHaveBeenCalledWith(env.BROWSER, { keep_alive: 600_000 });
    expect(browser.newContext).toHaveBeenCalledWith({ storageState: { cookies: ["x"] } });
    expect(session.mode).toBe("launched");
  });

  it("falls back to a cold launch when sessions() throws (local miniflare)", async () => {
    const env = makeEnv();
    const browser = makeBrowser();
    pw.sessions.mockRejectedValue(new Error("Unable to fetch new sessions"));
    pw.launch.mockResolvedValue(browser);

    const session = await openConnpassSession(env);

    expect(session.mode).toBe("launched");
    expect(pw.launch).toHaveBeenCalledTimes(1);
  });

  it("falls back to a cold launch when connect() loses the race", async () => {
    const env = makeEnv();
    const browser = makeBrowser();
    pw.sessions.mockResolvedValue([{ sessionId: "s1", startTime: 1 }]);
    pw.connect.mockRejectedValue(new Error("session already connected"));
    pw.launch.mockResolvedValue(browser);

    const session = await openConnpassSession(env);

    expect(pw.connect).toHaveBeenCalled();
    expect(session.mode).toBe("launched");
  });

  it("creates a context from KV storageState when the warm session has none", async () => {
    const env = makeEnv();
    await env.SESSION_KV.put(STORAGE_KEY, JSON.stringify({ cookies: [] }));
    const browser = makeBrowser({ contexts: [] });
    pw.sessions.mockResolvedValue([{ sessionId: "s1", startTime: 1 }]);
    pw.connect.mockResolvedValue(browser);

    const session = await openConnpassSession(env);

    expect(browser.newContext).toHaveBeenCalledWith({ storageState: { cookies: [] } });
    expect(session.mode).toBe("connected");
  });
});

describe("ensureLoggedIn — auth pre-check", () => {
  it("skips the dashboard nav on a recently verified warm session", async () => {
    const env = makeEnv();
    await env.SESSION_KV.put(CHECKED_KEY, String(Date.now()));

    await ensureLoggedIn(env, {
      mode: "connected",
      page: makePage(),
      persist: vi.fn(),
    } as Any);

    expect(login.isLoggedIn).not.toHaveBeenCalled();
  });

  it("re-checks a stale warm session and refreshes the timestamp", async () => {
    const env = makeEnv();
    await env.SESSION_KV.put(CHECKED_KEY, String(Date.now() - 10 * 60_000));
    const persist = vi.fn();

    await ensureLoggedIn(env, { mode: "connected", page: makePage(), persist } as Any);

    expect(login.isLoggedIn).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    const ts = Number(await env.SESSION_KV.get(CHECKED_KEY));
    expect(Date.now() - ts).toBeLessThan(5_000);
  });

  it("always checks a cold-launched session even with a fresh timestamp", async () => {
    const env = makeEnv();
    await env.SESSION_KV.put(CHECKED_KEY, String(Date.now()));

    await ensureLoggedIn(env, {
      mode: "launched",
      page: makePage(),
      persist: vi.fn(),
    } as Any);

    expect(login.isLoggedIn).toHaveBeenCalledTimes(1);
  });

  it("logs in with the bot password when the session is not authenticated", async () => {
    const env = makeEnv();
    login.isLoggedIn.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await ensureLoggedIn(env, {
      mode: "launched",
      page: makePage(),
      persist: vi.fn(),
    } as Any);

    expect(login.loginWithPassword).toHaveBeenCalledWith(expect.anything(), {
      email: "bot@example.com",
      password: "secret",
    });
    expect(await env.SESSION_KV.get(CHECKED_KEY)).toBeTruthy();
  });

  it("throws when the password login does not stick", async () => {
    const env = makeEnv();
    login.isLoggedIn.mockResolvedValue(false);

    await expect(
      ensureLoggedIn(env, { mode: "launched", page: makePage(), persist: vi.fn() } as Any),
    ).rejects.toThrow("connpass_login_failed");
  });
});

describe("release / destroy", () => {
  it("release() keeps a launched session warm but disconnects a connected one", async () => {
    const env = makeEnv();

    const launched = makeBrowser({ sessionId: "L" });
    pw.sessions.mockResolvedValue([]);
    pw.launch.mockResolvedValue(launched);
    await (await openConnpassSession(env)).release();
    expect(launched.close).not.toHaveBeenCalled();

    const ctx = makeContext([makePage()]);
    const connected = makeBrowser({ contexts: [ctx] });
    pw.sessions.mockResolvedValue([{ sessionId: "s1", startTime: 1 }]);
    pw.connect.mockResolvedValue(connected);
    await (await openConnpassSession(env)).release();
    expect(connected.close).toHaveBeenCalledTimes(1);
  });

  it("destroy() terminates a launched session and CDP-closes a connected one", async () => {
    const env = makeEnv();

    const launched = makeBrowser({ sessionId: "L" });
    pw.sessions.mockResolvedValue([]);
    pw.launch.mockResolvedValue(launched);
    await (await openConnpassSession(env)).destroy();
    expect(launched.close).toHaveBeenCalledTimes(1);

    const cdpSend = vi.fn();
    const ctx = makeContext([makePage()]);
    ctx.newCDPSession = vi.fn(async () => ({ send: cdpSend }));
    const connected = makeBrowser({ contexts: [ctx] });
    pw.sessions.mockResolvedValue([{ sessionId: "s1", startTime: 1 }]);
    pw.connect.mockResolvedValue(connected);
    await (await openConnpassSession(env)).destroy();
    expect(cdpSend).toHaveBeenCalledWith("Browser.close");
    expect(connected.close).not.toHaveBeenCalled();
  });
});

describe("forceRelogin", () => {
  it("always cold-launches, logs in, persists, clears the marker, and tears down", async () => {
    const env = makeEnv();
    await env.SESSION_KV.put(CHECKED_KEY, String(Date.now()));
    const browser = makeBrowser({ sessionId: "R" });
    // A free session exists — forceRelogin must not reuse it.
    pw.sessions.mockResolvedValue([{ sessionId: "free", startTime: 1 }]);
    pw.launch.mockResolvedValue(browser);
    login.isLoggedIn.mockResolvedValue(true);

    await forceRelogin(env);

    expect(pw.connect).not.toHaveBeenCalled();
    expect(pw.launch).toHaveBeenCalledTimes(1);
    expect(login.loginWithPassword).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(await env.SESSION_KV.get(CHECKED_KEY)).toBeNull();
    expect(await env.SESSION_KV.get(STORAGE_KEY)).toBeTruthy();
  });
});
