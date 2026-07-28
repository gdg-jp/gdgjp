import { describe, expect, it, vi } from "vitest";
import { isWebsiteRequest, routeApexRequest } from "./apex-routing";

describe("apex request routing", () => {
  it.each(["/", "/privacy", "/terms", "/assets/entry.client.js", "/favicon.svg"])(
    "keeps %s in the website worker",
    (pathname) => {
      expect(isWebsiteRequest(new URL(pathname, "https://gdgs.jp"))).toBe(true);
    },
  );

  it.each(["/cli/install.sh", "/community", "/abc123"])("delegates %s to TinyURL", (pathname) => {
    expect(isWebsiteRequest(new URL(pathname, "https://gdgs.jp"))).toBe(false);
  });

  it("delegates the original request to TinyURL", async () => {
    const request = new Request("https://gdgs.jp/cli/install.sh");
    const website = vi.fn();
    const tinyurl = { fetch: vi.fn().mockResolvedValue(new Response("installer")) };

    const response = await routeApexRequest(request, website, tinyurl);

    expect(await response.text()).toBe("installer");
    expect(website).not.toHaveBeenCalled();
    expect(tinyurl.fetch).toHaveBeenCalledWith(request);
  });

  it("keeps policy pages in the website worker", async () => {
    const request = new Request("https://gdgs.jp/privacy");
    const website = vi.fn().mockResolvedValue(new Response("privacy"));
    const tinyurl = { fetch: vi.fn() };

    const response = await routeApexRequest(request, website, tinyurl);

    expect(await response.text()).toBe("privacy");
    expect(website).toHaveBeenCalledWith(request);
    expect(tinyurl.fetch).not.toHaveBeenCalled();
  });
});
