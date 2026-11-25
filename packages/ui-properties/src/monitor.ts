import type { BrowserContext, Locator, Page } from "@playwright/test";
import { PropertyViolation } from "./engine";

export type MonitorOptions = {
  readonly origins?: readonly string[];
  readonly ignoreConsole?: readonly RegExp[];
  readonly ignoreResponses?: readonly RegExp[];
  readonly navigationOptional?: readonly RegExp[];
};

type Problem = { readonly check: string; readonly message: string };

const CONTROL_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[role=button]",
  "[role=link]",
  "[role=menuitem]",
  "[role=tab]",
  "[role=menuitemcheckbox]",
  "[role=menuitemradio]",
  "[role=option]",
  "[role=radio]",
  "[role=switch]",
  "[role=checkbox]",
  "[contenteditable=true]",
].join(",");

const ABORTED_ROUTE_DISCOVERY = /^Failed to fetch manifest patches TypeError: Failed to fetch/;

export class PageMonitor {
  readonly #options: MonitorOptions;
  readonly #problems: Problem[] = [];
  readonly #detach: (() => void)[] = [];
  readonly #pages = new Set<Page>();
  readonly touched = new Map<string, number>();

  constructor(options: MonitorOptions = {}) {
    this.#options = options;
  }

  #allowedOrigin(url: string): boolean {
    const origins = this.#options.origins;
    if (!origins?.length) return true;
    try {
      return origins.includes(new URL(url).origin);
    } catch {
      return false;
    }
  }

  watch(page: Page): void {
    if (this.#pages.has(page)) return;
    this.#pages.add(page);
    const onConsole = (entry: { type(): string; text(): string; location(): { url: string } }) => {
      if (entry.type() !== "error") return;
      const text = entry.text();
      if (this.#options.ignoreConsole?.some((pattern) => pattern.test(text))) return;
      if (/the server responded with a status of 5\d\d/.test(text)) return;
      if (ABORTED_ROUTE_DISCOVERY.test(text)) return;
      if (text.startsWith("Failed to load resource") && !this.#allowedOrigin(entry.location().url))
        return;
      this.#problems.push({
        check: "no console errors",
        message: `console error on ${page.url()}: ${text}`,
      });
    };
    const onPageError = (error: Error) => {
      this.#problems.push({
        check: "no uncaught exceptions",
        message: `uncaught exception on ${page.url()}: ${error.message}`,
      });
    };
    const onResponse = (response: {
      status(): number;
      url(): string;
      request(): { method(): string };
    }) => {
      const url = response.url();
      if (response.status() < 500 || !this.#allowedOrigin(url)) return;
      if (this.#options.ignoreResponses?.some((pattern) => pattern.test(url))) return;
      this.#problems.push({
        check: "no 5xx responses",
        message: `${response.request().method()} ${url} returned ${response.status()}`,
      });
    };
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    page.on("response", onResponse);
    page.on("close", () => this.#pages.delete(page));
    this.#detach.push(() => {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("response", onResponse);
    });
  }

  watchContext(context: BrowserContext): void {
    for (const page of context.pages()) this.watch(page);
    const onPage = (page: Page) => this.watch(page);
    context.on("page", onPage);
    this.#detach.push(() => context.off("page", onPage));
  }

  record(check: string, message: string): void {
    this.#problems.push({ check, message });
  }

  async observe(): Promise<void> {
    for (const page of this.#pages) {
      if (page.isClosed()) continue;
      await this.#assertNavigable(page);
    }
    const problem = this.#problems.shift();
    if (problem) {
      this.#problems.length = 0;
      throw new PropertyViolation("monitor", problem.check, problem.message);
    }
  }

  async #assertNavigable(page: Page): Promise<void> {
    const url = page.url();
    if (!url.startsWith("http") || !this.#allowedOrigin(url)) return;
    const path = new URL(url).pathname;
    if (this.#options.navigationOptional?.some((pattern) => pattern.test(path))) return;
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    const measure = () =>
      page.evaluate((selector) => {
        const visible = (element: Element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return (
            box.width > 0 &&
            box.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            !element.closest("[inert],[aria-hidden=true]")
          );
        };
        const controls = [...document.querySelectorAll(selector)].filter(
          (element) => visible(element) && !element.matches(":disabled,[aria-disabled=true]"),
        );
        return {
          text: (document.body?.innerText ?? "").trim().length,
          controls: controls.length,
        };
      }, CONTROL_SELECTOR);
    let state: Awaited<ReturnType<typeof measure>> | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      state = await measure().catch(() => null);
      if (!state || state.controls > 0) return;
      await page.waitForTimeout(250);
    }
    if (!state) return;
    if (state.text === 0 && state.controls === 0)
      throw new PropertyViolation("monitor", "no dead ends", `${url} rendered an empty page`);
    if (state.controls === 0)
      throw new PropertyViolation(
        "monitor",
        "no dead ends",
        `${url} has no visible enabled link or control to leave it`,
      );
  }

  detach(): void {
    for (const detach of this.#detach.splice(0)) detach();
    this.#pages.clear();
  }
}

export type AccessibleControl = { readonly role: string; readonly name: string };

export function parseAriaSnapshot(snapshot: string): AccessibleControl | null {
  const line = snapshot.split("\n").find((entry) => entry.trim().startsWith("- "));
  if (!line) return null;
  const match = /^\s*- ([a-z]+)(?: "((?:[^"\\]|\\.)*)")?/.exec(line);
  if (!match?.[1]) return null;
  let name = "";
  if (match[2] !== undefined) {
    try {
      name = JSON.parse(`"${match[2]}"`) as string;
    } catch {
      name = match[2];
    }
  }
  return { role: match[1], name };
}

export async function readControl(locator: Locator): Promise<AccessibleControl | null> {
  await locator.waitFor({ state: "attached", timeout: 5_000 });
  return parseAriaSnapshot(await locator.ariaSnapshot({ timeout: 5_000 }));
}

export async function accessibleControl(locator: Locator): Promise<AccessibleControl> {
  const control = await readControl(locator);
  if (!control?.name.trim()) {
    const html = await locator
      .evaluate((element) => element.outerHTML.slice(0, 200))
      .catch(() => null);
    if (html === null) throw new Error("the control was removed before it could be used");
    throw new PropertyViolation(
      "monitor",
      "accessible name on every touched control",
      `${control?.role ?? "element"} has no accessible name: ${html}`,
    );
  }
  return control;
}

export class Ui {
  readonly monitor: PageMonitor;
  constructor(monitor: PageMonitor) {
    this.monitor = monitor;
  }

  async #touch(locator: Locator): Promise<AccessibleControl> {
    const control = await accessibleControl(locator);
    const key = `${control.role} "${control.name}"`;
    this.monitor.touched.set(key, (this.monitor.touched.get(key) ?? 0) + 1);
    return control;
  }

  async click(locator: Locator): Promise<void> {
    await this.#touch(locator);
    await locator.click();
  }

  async fill(locator: Locator, value: string): Promise<void> {
    await this.#touch(locator);
    await locator.fill(value);
  }

  async check(locator: Locator, checked: boolean): Promise<void> {
    await this.#touch(locator);
    await locator.setChecked(checked);
  }

  async select(locator: Locator, value: string): Promise<void> {
    await this.#touch(locator);
    await locator.selectOption(value);
  }

  async touch(locator: Locator): Promise<AccessibleControl> {
    return this.#touch(locator);
  }
}
