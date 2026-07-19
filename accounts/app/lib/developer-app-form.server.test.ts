import { describe, expect, it } from "vitest";
import { parseDeveloperClientForm } from "./developer-app-form.server";

describe("parseDeveloperClientForm", () => {
  it("accepts URI fields added as individual form controls", () => {
    const form = new FormData();
    form.set("name", "Example client");
    form.set("appUrl", "https://example.com");
    form.append("redirectUris", "https://example.com/callback");
    form.append("redirectUris", "http://localhost:3000/callback");
    form.append("postLogoutRedirectUris", "https://example.com/signed-out");
    form.append("scopes", "openid");
    form.append("scopes", "email");

    expect(parseDeveloperClientForm(form)).toEqual({
      name: "Example client",
      appUrl: "https://example.com",
      redirectUris: ["https://example.com/callback", "http://localhost:3000/callback"],
      postLogoutRedirectUris: ["https://example.com/signed-out"],
      scopes: ["openid", "email"],
    });
  });

  it("keeps compatibility with newline-separated URI values", () => {
    const form = new FormData();
    form.set("redirectUris", "https://one.example/callback\nhttps://two.example/callback");

    expect(parseDeveloperClientForm(form).redirectUris).toEqual([
      "https://one.example/callback",
      "https://two.example/callback",
    ]);
  });
});
