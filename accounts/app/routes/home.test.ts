import { describe, expect, it } from "vitest";
import { homeRedirect } from "./home";

describe("home route", () => {
  it("sends an unauthenticated visitor directly to sign in", () => {
    expect(homeRedirect(false)).toBe("/signin");
  });

  it("sends an authenticated visitor to the dashboard", () => {
    expect(homeRedirect(true)).toBe("/dashboard");
  });
});
