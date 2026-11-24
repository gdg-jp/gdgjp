import { readFileSync } from "node:fs";
import { type Browser, test } from "@playwright/test";
import {
  DESTRUCTIVE_CONTROLS,
  type ExploreWorld,
  PropertyViolation,
  Ui,
  type UiProperty,
  checkUiProperty,
  exploreActions,
  invariant,
  runPlan,
} from "../src/index";

type Target = { app: string; url: string };

export function parseTargets(value: string): Target[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [app, url] = entry.split("=");
      if (!app || !url || !/^(?:https:\/\/|http:\/\/(?:localhost|127\.0\.0\.1)[:/])/.test(url))
        throw new Error(`Invalid fuzz target: ${entry}`);
      return { app, url: new URL(url).origin };
    });
}

const targets = parseTargets(process.env.UI_FUZZ_TARGETS ?? "");
const accounts = process.env.UI_FUZZ_ACCOUNTS_URL;
const sessionFile = process.env.UI_FUZZ_SESSION_FILE;
const domain = process.env.UI_FUZZ_DOMAIN;
const accessHeaders: Record<string, string> =
  process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
    ? {
        "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
        "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
      }
    : {};
const plan = runPlan({ seeds: [4242, 8675], steps: 150, minutes: 6 });

const inSlot = (url: string) => {
  if (!domain) return false;
  const host = new URL(url).hostname;
  return host === domain || host.endsWith(`.${domain}`);
};

function property(browser: Browser, target: Target) {
  const origins = [target.url, ...(accounts ? [new URL(accounts).origin] : [])];
  const definition: UiProperty<ExploreWorld & { context: { close(): Promise<void> } }> = {
    name: `staging exploration of ${target.app}`,
    setup: async (monitor) => {
      const context = await browser.newContext({
        ...(sessionFile ? { storageState: JSON.parse(readFileSync(sessionFile, "utf8")) } : {}),
        locale: "ja-JP",
      });
      await context.route("**/*", (route) => {
        const request = route.request();
        if (!inSlot(request.url())) return route.continue();
        return route.continue({ headers: { ...request.headers(), ...accessHeaders } });
      });
      monitor.watchContext(context);
      const page = await context.newPage();
      if (target.app !== "accounts" && sessionFile)
        await page.goto(`${target.url}/api/auth/signin`, { waitUntil: "domcontentloaded" });
      await page.goto(target.url, { waitUntil: "domcontentloaded" });
      return {
        ui: new Ui(monitor),
        monitor,
        page,
        context,
        start: target.url,
        origins,
        avoid: DESTRUCTIVE_CONTROLS,
      };
    },
    teardown: (world) => world.context.close(),
    actions: exploreActions(),
    invariants: [
      invariant("Access never asks the fuzzer to sign in", async (world) => {
        const host = new URL(world.page.url()).hostname;
        if (host === "cloudflareaccess.com" || host.endsWith(".cloudflareaccess.com"))
          throw new PropertyViolation(
            "setup",
            "Access never asks the fuzzer to sign in",
            "Cloudflare Access redirected to its login page; check the service token",
          );
      }),
    ],
  };
  return definition;
}

test.describe.configure({ retries: 0 });

for (const target of targets) {
  for (const seed of plan.seeds) {
    test(`${target.app} seed ${seed}`, async ({ browser }, testInfo) => {
      await checkUiProperty(testInfo, property(browser, target), {
        plan,
        seed,
        target: `${target.app}=${target.url}`,
        monitor: { origins: [target.url] },
      });
    });
  }
}
