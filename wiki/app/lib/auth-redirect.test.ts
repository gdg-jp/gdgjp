import { describe, expect, it } from "vitest";
import { buildSignInRedirect, safeReturnTo } from "./auth-redirect";

describe("auth redirects", () => {
  it("preserves a local path and query when redirecting to sign in", () => {
    const response = buildSignInRedirect(
      new Request("https://wiki.example/wiki/example?language=ja"),
    );

    expect(response.headers.get("Location")).toBe(
      "/signin?return_to=%2Fwiki%2Fexample%3Flanguage%3Dja",
    );
  });

  it("accepts only same-origin return paths", () => {
    expect(safeReturnTo("/wiki/example")).toBe("/wiki/example");
    expect(safeReturnTo("https://evil.example/path")).toBeNull();
    expect(safeReturnTo("//evil.example/path")).toBeNull();
  });
});
