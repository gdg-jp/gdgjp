import { describe, expect, it } from "vitest";
import { prefersMobileImage } from "./device";

describe("prefersMobileImage", () => {
  it("prefers the UA-CH mobile signal", () => {
    const headers = new Headers({ "Sec-CH-UA-Mobile": "?1", "User-Agent": "Desktop" });
    expect(prefersMobileImage(headers)).toBe(true);
  });

  it("honors an explicit desktop UA-CH signal", () => {
    const headers = new Headers({
      "Sec-CH-UA-Mobile": "?0",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    });
    expect(prefersMobileImage(headers)).toBe(false);
  });

  it("uses a device client hint when UA-CH is unavailable", () => {
    expect(prefersMobileImage(new Headers({ "CF-Device-Type": "mobile" }))).toBe(true);
  });

  it("falls back to the user agent", () => {
    const headers = new Headers({ "User-Agent": "Mozilla/5.0 (Linux; Android 15; Mobile)" });
    expect(prefersMobileImage(headers)).toBe(true);
  });
});
