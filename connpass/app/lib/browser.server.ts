import { type Browser, type BrowserContext, type Page, launch } from "@cloudflare/playwright";
import { isLoggedIn, loginWithPassword } from "./connpass-ui/login";
import { botCredentials, loadStorageState, saveStorageState } from "./session.server";

export type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  persist: () => Promise<void>;
  close: () => Promise<void>;
};

export async function openConnpassSession(env: Env): Promise<BrowserSession> {
  const storageState = await loadStorageState(env);
  const browser = await launch(env.BROWSER);
  const context = await browser.newContext(
    storageState ? { storageState: storageState as never } : undefined,
  );
  const page = await context.newPage();

  const persist = async () => {
    const next = await context.storageState({ indexedDB: true });
    await saveStorageState(env, next);
  };

  const close = async () => {
    await browser.close();
  };

  return { browser, context, page, persist, close };
}

export async function ensureLoggedIn(env: Env, session: BrowserSession): Promise<void> {
  if (await isLoggedIn(session.page)) {
    await session.persist();
    return;
  }
  const credentials = botCredentials(env);
  await loginWithPassword(session.page, credentials);
  if (!(await isLoggedIn(session.page))) {
    throw new Error("connpass_login_failed");
  }
  await session.persist();
}

export async function forceRelogin(env: Env): Promise<void> {
  const session = await openConnpassSession(env);
  try {
    const credentials = botCredentials(env);
    await loginWithPassword(session.page, credentials);
    if (!(await isLoggedIn(session.page))) {
      throw new Error("connpass_login_failed");
    }
    await session.persist();
  } finally {
    await session.close();
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
