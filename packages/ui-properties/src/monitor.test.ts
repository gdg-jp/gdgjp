import { EventEmitter } from "node:events";
import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { PageMonitor } from "./monitor";

const APP = "http://localhost:6185";

function fakePage(): { page: Page; consoleError(text: string, url: string): void } {
  const emitter = new EventEmitter();
  const page = Object.assign(emitter, {
    url: () => `${APP}/board`,
    isClosed: () => true,
  }) as unknown as Page;
  return {
    page,
    consoleError: (text, url) =>
      emitter.emit("console", { type: () => "error", text: () => text, location: () => ({ url }) }),
  };
}

describe("PageMonitor console errors", () => {
  it("ignores a resource that failed to load from an origin outside the app", async () => {
    const monitor = new PageMonitor({ origins: [APP] });
    const { page, consoleError } = fakePage();
    monitor.watch(page);
    consoleError(
      "Failed to load resource: net::ERR_CONNECTION_TIMED_OUT",
      "https://fonts.googleapis.com/css2?family=Roboto",
    );
    await expect(monitor.observe()).resolves.toBeUndefined();
  });

  it("reports a resource that failed to load from the app itself", async () => {
    const monitor = new PageMonitor({ origins: [APP] });
    const { page, consoleError } = fakePage();
    monitor.watch(page);
    consoleError("Failed to load resource: net::ERR_CONNECTION_REFUSED", `${APP}/assets/app.js`);
    await expect(monitor.observe()).rejects.toThrow(/no console errors|Failed to load resource/);
  });

  it("reports other console errors whatever script logged them", async () => {
    const monitor = new PageMonitor({ origins: [APP] });
    const { page, consoleError } = fakePage();
    monitor.watch(page);
    consoleError("TypeError: boom", "https://cdn.example/lib.js");
    await expect(monitor.observe()).rejects.toThrow(/boom/);
  });

  it("ignores route discovery aborted by a navigation", async () => {
    const monitor = new PageMonitor({ origins: [APP] });
    const { page, consoleError } = fakePage();
    monitor.watch(page);
    consoleError("Failed to fetch manifest patches TypeError: Failed to fetch", `${APP}/links`);
    await expect(monitor.observe()).resolves.toBeUndefined();
  });
});
