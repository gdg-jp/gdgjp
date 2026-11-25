import { describe, expect, it } from "vitest";
import { isHostOrSubdomain, withoutTrailingSlashes } from "./url";

describe("isHostOrSubdomain", () => {
  it("accepts the domain and its subdomains, including a cookie's leading dot", () => {
    expect(isHostOrSubdomain("connpass.com", "connpass.com")).toBe(true);
    expect(isHostOrSubdomain("gdg.connpass.com", "connpass.com")).toBe(true);
    expect(isHostOrSubdomain(".connpass.com", "connpass.com")).toBe(true);
    expect(isHostOrSubdomain("Photos.Google.com", "photos.google.com")).toBe(true);
  });

  it("refuses a host that only ends with the same letters", () => {
    expect(isHostOrSubdomain("evilconnpass.com", "connpass.com")).toBe(false);
    expect(isHostOrSubdomain("connpass.com.evil.example", "connpass.com")).toBe(false);
    expect(isHostOrSubdomain("notphotos.google.com", "photos.google.com")).toBe(false);
  });
});

describe("withoutTrailingSlashes", () => {
  it("removes every trailing slash and nothing else", () => {
    expect(withoutTrailingSlashes("https://a.example///")).toBe("https://a.example");
    expect(withoutTrailingSlashes("https://a.example/x")).toBe("https://a.example/x");
    expect(withoutTrailingSlashes("///")).toBe("");
  });

  it("stays linear on long runs of slashes", () => {
    const value = `a${"/".repeat(200_000)}b${"/".repeat(200_000)}`;
    const started = performance.now();
    expect(withoutTrailingSlashes(value)).toBe(`a${"/".repeat(200_000)}b`);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
