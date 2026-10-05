import { describe, expect, it } from "vitest";
import { goUrl, searchFallback } from "./redirect.js";

describe("go links", () => {
  it("creates canonical URLs without storing input", () => {
    expect(goUrl("docs")).toBe("https://go.gdgs.jp/docs");
    expect(goUrl("go/docs")).toBe("https://go.gdgs.jp/docs");
    expect(goUrl("not valid")).toBeNull();
  });

  it("recognizes only an entire supported search query", () => {
    expect(searchFallback("https://www.google.com/search?q=go%2Fdocs")).toBe(
      "https://go.gdgs.jp/docs",
    );
    expect(searchFallback("https://www.bing.com/search?q=please+go%2Fdocs")).toBeNull();
    expect(searchFallback("https://example.com/?q=go%2Fdocs")).toBeNull();
  });
});
