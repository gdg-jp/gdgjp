import { beforeEach, describe, expect, it, vi } from "vitest";

const browser = vi.hoisted(() => ({
  openConnpassSession: vi.fn(),
  ensureLoggedIn: vi.fn(),
  forceRelogin: vi.fn(),
}));

vi.mock("./browser.server", () => browser);

const events = vi.hoisted(() => ({
  scrapeGroupEvents: vi.fn(),
  scrapeEventDetail: vi.fn(),
  scrapeSubEvents: vi.fn(),
}));

vi.mock("./connpass-ui/events", () => events);

import { listGroupEventsInBrowser } from "./connpass-browser-read.server";

// biome-ignore lint/suspicious/noExplicitAny: lightweight test doubles
type Any = any;

function fakeSession(url = "https://connpass.com/event/1/"): Any {
  return {
    mode: "connected",
    page: { url: () => url },
    persist: vi.fn(),
    release: vi.fn(),
    destroy: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  browser.openConnpassSession.mockImplementation(async () => fakeSession());
  browser.ensureLoggedIn.mockResolvedValue(undefined);
  browser.forceRelogin.mockResolvedValue(undefined);
});

describe("withConnpassRead", () => {
  it("returns the scrape result and releases the session on the happy path", async () => {
    const session = fakeSession();
    browser.openConnpassSession.mockImplementationOnce(async () => session);
    events.scrapeGroupEvents.mockResolvedValue([{ id: 1 }]);

    const out = await listGroupEventsInBrowser({} as Env, "gdg-tokyo");

    expect(out).toEqual([{ id: 1 }]);
    expect(browser.forceRelogin).not.toHaveBeenCalled();
    expect(session.release).toHaveBeenCalledTimes(1);
    expect(session.destroy).not.toHaveBeenCalled();
  });

  it("retries once after forceRelogin when the scrape hits a login wall", async () => {
    const s1 = fakeSession();
    const s2 = fakeSession();
    browser.openConnpassSession
      .mockImplementationOnce(async () => s1)
      .mockImplementationOnce(async () => s2);
    events.scrapeGroupEvents
      .mockRejectedValueOnce(new Error("connpass_login_failed"))
      .mockResolvedValueOnce([{ id: 2 }]);

    const out = await listGroupEventsInBrowser({} as Env, "g");

    expect(out).toEqual([{ id: 2 }]);
    expect(browser.forceRelogin).toHaveBeenCalledTimes(1);
    expect(s1.destroy).toHaveBeenCalledTimes(1);
    expect(s2.release).toHaveBeenCalledTimes(1);
  });

  it("detects an auth wall from a redirect to /login", async () => {
    browser.openConnpassSession
      .mockImplementationOnce(async () => fakeSession("https://connpass.com/login/"))
      .mockImplementationOnce(async () => fakeSession());
    events.scrapeGroupEvents
      .mockRejectedValueOnce(new Error("element not found"))
      .mockResolvedValueOnce([{ id: 3 }]);

    const out = await listGroupEventsInBrowser({} as Env, "g");

    expect(out).toEqual([{ id: 3 }]);
    expect(browser.forceRelogin).toHaveBeenCalledTimes(1);
  });

  it("gives up after a single retry", async () => {
    events.scrapeGroupEvents.mockRejectedValue(new Error("still stuck on /login"));

    await expect(listGroupEventsInBrowser({} as Env, "g")).rejects.toThrow("still stuck on /login");
    expect(browser.forceRelogin).toHaveBeenCalledTimes(1);
  });

  it("does not retry on a non-auth error", async () => {
    events.scrapeGroupEvents.mockRejectedValue(new Error("selector timeout"));

    await expect(listGroupEventsInBrowser({} as Env, "g")).rejects.toThrow("selector timeout");
    expect(browser.forceRelogin).not.toHaveBeenCalled();
  });
});
