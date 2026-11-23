import { describe, expect, it } from "vitest";
import { gdgAccountSettingsUrl, gdgAppLinks, gdgSiteDomain } from "./app-links";

describe("gdgAppLinks", () => {
  it("links production apps to production hosts", () => {
    const links = gdgAppLinks("https://accounts.gdgs.jp");
    expect(links.find((link) => link.label === "Wiki")).toEqual({
      iconUrl: "https://wiki.gdgs.jp/app-icon.png",
      label: "Wiki",
      url: "https://wiki.gdgs.jp",
    });
  });

  it("keeps a staging slot's links inside that slot", () => {
    const links = gdgAppLinks("https://accounts.stg2.gdgs.jp/");
    const site = links.filter((link) => link.url.includes(".gdgs.jp") && link.label !== "Learn");
    expect(site.map((link) => link.url)).toEqual([
      "https://url.stg2.gdgs.jp",
      "https://wiki.stg2.gdgs.jp",
      "https://scheduler.stg2.gdgs.jp",
      "https://img.stg2.gdgs.jp",
      "https://sns.stg2.gdgs.jp",
      "https://connpass.stg2.gdgs.jp",
      "https://pay.stg2.gdgs.jp",
    ]);
    expect(site.every((link) => link.iconUrl.startsWith(`${link.url}/`))).toBe(true);
    expect(links.find((link) => link.label === "Learn")?.url).toBe("https://learn.gdgs.jp");
  });

  it("falls back to production for local or foreign Accounts origins", () => {
    expect(gdgSiteDomain("http://localhost:5173")).toBe("gdgs.jp");
    expect(gdgSiteDomain("https://accounts.evil.example")).toBe("gdgs.jp");
    expect(gdgSiteDomain("not a url")).toBe("gdgs.jp");
    expect(gdgSiteDomain(undefined)).toBe("gdgs.jp");
  });
});

describe("gdgAccountSettingsUrl", () => {
  it("points at the deployment's Accounts dashboard", () => {
    expect(gdgAccountSettingsUrl("https://accounts.stg1.gdgs.jp/")).toBe(
      "https://accounts.stg1.gdgs.jp/dashboard",
    );
    expect(gdgAccountSettingsUrl("http://localhost:5173")).toBe("http://localhost:5173/dashboard");
    expect(gdgAccountSettingsUrl(undefined)).toBe("https://accounts.gdgs.jp/dashboard");
  });
});
