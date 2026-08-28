import {
  type Browser,
  type BrowserContext,
  type Page,
  connect,
  launch,
  sessions,
} from "@cloudflare/playwright";
import { isLoggedIn, loginWithPassword } from "./connpass-ui/login";
import {
  botCredentials,
  clearSessionChecked,
  loadSessionCheckedAt,
  loadStorageState,
  markSessionChecked,
  saveStorageState,
} from "./session.server";

/** Max keep-alive the Browser Rendering API accepts (10 minutes). */
const KEEP_ALIVE_MS = 600_000;
/** Skip the dashboard auth re-check when a warm session was verified this recently. */
const SESSION_FRESH_MS = 3 * 60_000;

export type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** "connected" = reused a warm keep-alive session; "launched" = fresh cold start. */
  mode: "connected" | "launched";
  persist: () => Promise<void>;
  /** Happy-path teardown: leave the remote session warm for the next request. */
  release: () => Promise<void>;
  /** Error / relogin teardown: terminate the remote session. */
  destroy: () => Promise<void>;
};

function buildSession(
  env: Env,
  browser: Browser,
  context: BrowserContext,
  page: Page,
  mode: "connected" | "launched",
): BrowserSession {
  const persist = async () => {
    const next = await context.storageState({ indexedDB: true });
    await saveStorageState(env, next);
  };

  const release = async () => {
    try {
      // A launched browser's close() sends Browser.close and terminates the remote
      // session, so never call it on the happy path — the invocation ending drops
      // the socket and keep_alive holds Chrome open for the next request. A
      // connected browser's close() only disconnects, freeing connectionId so the
      // next invocation can reconnect.
      if (mode === "connected") {
        await browser.close();
      }
    } catch {
      // best effort — must never break the happy path
    }
  };

  const destroy = async () => {
    try {
      if (mode === "launched") {
        await browser.close();
        return;
      }
      try {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Browser.close" as never);
      } catch {
        await browser.close();
      }
    } catch {
      // best effort
    }
  };

  return { browser, context, page, mode, persist, release, destroy };
}

async function tryConnectWarmSession(env: Env): Promise<BrowserSession | null> {
  let active: Awaited<ReturnType<typeof sessions>>;
  try {
    active = await sessions(env.BROWSER);
  } catch {
    // Local miniflare without /v1/sessions, or a transient API error — cold launch.
    return null;
  }

  const free = active.filter((s) => !s.connectionId).sort((a, b) => b.startTime - a.startTime);

  for (const candidate of free) {
    try {
      const browser = await connect(env.BROWSER, candidate.sessionId);
      let context = browser.contexts()[0];
      if (!context) {
        const storageState = await loadStorageState(env);
        context = await browser.newContext(
          storageState ? { storageState: storageState as never } : undefined,
        );
      }
      const page = context.pages()[0] ?? (await context.newPage());
      console.log("connpass session: reused warm", candidate.sessionId);
      return buildSession(env, browser, context, page, "connected");
    } catch {
      // Lost the race for this session (one connection per session) or it died —
      // try the next free candidate, then fall through to a cold launch.
    }
  }
  return null;
}

async function coldLaunchSession(env: Env): Promise<BrowserSession> {
  const storageState = await loadStorageState(env);
  const browser = await launch(env.BROWSER, { keep_alive: KEEP_ALIVE_MS });
  const context = await browser.newContext(
    storageState ? { storageState: storageState as never } : undefined,
  );
  const page = await context.newPage();
  console.log("connpass session: cold launch", browser.sessionId());
  return buildSession(env, browser, context, page, "launched");
}

export async function openConnpassSession(env: Env): Promise<BrowserSession> {
  return (await tryConnectWarmSession(env)) ?? (await coldLaunchSession(env));
}

export async function ensureLoggedIn(env: Env, session: BrowserSession): Promise<void> {
  if (session.mode === "connected") {
    const checkedAt = await loadSessionCheckedAt(env);
    if (checkedAt && Date.now() - checkedAt < SESSION_FRESH_MS) {
      // Warm session verified moments ago — trust it and skip the dashboard nav.
      return;
    }
  }
  // Cold launch (context seeded from possibly-stale KV storageState) or a warm
  // session past the freshness window: do the full check.
  if (await isLoggedIn(session.page)) {
    await markSessionChecked(env);
    await session.persist();
    return;
  }
  const credentials = botCredentials(env);
  await loginWithPassword(session.page, credentials);
  if (!(await isLoggedIn(session.page))) {
    throw new Error("connpass_login_failed");
  }
  await markSessionChecked(env);
  await session.persist();
}

export async function forceRelogin(env: Env): Promise<void> {
  // Never connect() to a possibly-poisoned warm session here — always start fresh.
  const session = await coldLaunchSession(env);
  try {
    const credentials = botCredentials(env);
    await loginWithPassword(session.page, credentials);
    if (!(await isLoggedIn(session.page))) {
      throw new Error("connpass_login_failed");
    }
    await session.persist();
    // Drop the freshness marker so the next ensureLoggedIn re-validates even on a
    // warm connect (a stale session may still be in the pool).
    await clearSessionChecked(env);
  } finally {
    await session.destroy();
  }
}

/** Best-effort Live View URL for CAPTCHA / unexpected walls. */
export async function tryGetLiveViewUrl(page: Page): Promise<string | null> {
  try {
    const cdp = await page.context().newCDPSession(page);
    const result = (await cdp.send(
      "Cloudflare.getLiveView" as never,
      {
        mode: "tab",
        expiresInMs: 600_000,
      } as never,
    )) as { devtoolsFrontendUrl?: string };
    return result.devtoolsFrontendUrl ?? null;
  } catch {
    return null;
  }
}

export async function captureFailureArtifact(
  env: Env,
  jobId: string,
  page: Page,
): Promise<string | null> {
  try {
    const png = await page.screenshot({ fullPage: true });
    const key = `jobs/${jobId}/failure.png`;
    await env.ARTIFACTS.put(key, png, {
      httpMetadata: { contentType: "image/png" },
    });
    return key;
  } catch {
    return null;
  }
}
