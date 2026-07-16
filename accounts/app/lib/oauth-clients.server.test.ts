import { describe, expect, it } from "vitest";
import { CHAPTERS_SCOPE } from "./auth.server";
import {
  DeveloperClientValidationError,
  validateDeveloperClientInput,
} from "./oauth-clients.server";

const validInput = {
  name: "Example application",
  appUrl: "https://example.com/app",
  redirectUris: ["https://example.com/oauth/callback"],
  postLogoutRedirectUris: ["https://example.com/signed-out"],
  scopes: ["email", CHAPTERS_SCOPE],
};

describe("validateDeveloperClientInput", () => {
  it("normalizes values and always includes openid", () => {
    expect(
      validateDeveloperClientInput({
        ...validInput,
        name: "  Example application  ",
        redirectUris: ["https://example.com/oauth/callback"],
      }),
    ).toEqual({
      name: "Example application",
      appUrl: "https://example.com/app",
      redirectUris: ["https://example.com/oauth/callback"],
      postLogoutRedirectUris: ["https://example.com/signed-out"],
      scopes: ["openid", "email", CHAPTERS_SCOPE],
    });
  });

  it.each([
    "http://example.com/callback",
    "ftp://example.com/callback",
    "https://user:password@example.com/callback",
    "https://example.com/callback#fragment",
  ])("rejects an unsafe URI: %s", (redirectUri) => {
    expect(() =>
      validateDeveloperClientInput({ ...validInput, redirectUris: [redirectUri] }),
    ).toThrow(DeveloperClientValidationError);
  });

  it.each([
    "http://localhost:3000/callback",
    "http://127.0.0.1:3000/callback",
    "http://[::1]:3000/callback",
  ])("allows HTTP for an exact loopback host: %s", (redirectUri) => {
    expect(
      validateDeveloperClientInput({ ...validInput, redirectUris: [redirectUri] }).redirectUris,
    ).toEqual([redirectUri]);
  });

  it("rejects duplicate URIs after URL canonicalization", () => {
    expect(() =>
      validateDeveloperClientInput({
        ...validInput,
        redirectUris: ["https://example.com", "https://example.com/"],
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_redirect_uri" }));
  });

  it("rejects more than ten URIs", () => {
    expect(() =>
      validateDeveloperClientInput({
        ...validInput,
        redirectUris: Array.from(
          { length: 11 },
          (_, index) => `https://example.com/callback/${index}`,
        ),
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_redirect_uri" }));
  });

  it("requires at least one redirect URI", () => {
    expect(() => validateDeveloperClientInput({ ...validInput, redirectUris: [] })).toThrowError(
      expect.objectContaining({ code: "invalid_redirect_uri" }),
    );
  });

  it("rejects unsupported scopes", () => {
    expect(() =>
      validateDeveloperClientInput({ ...validInput, scopes: ["openid", "admin"] }),
    ).toThrowError(expect.objectContaining({ code: "invalid_scope" }));
  });

  it("rejects an empty or overlong name", () => {
    expect(() => validateDeveloperClientInput({ ...validInput, name: "   " })).toThrowError(
      expect.objectContaining({ code: "invalid_name" }),
    );
    expect(() =>
      validateDeveloperClientInput({ ...validInput, name: "x".repeat(101) }),
    ).toThrowError(expect.objectContaining({ code: "invalid_name" }));
  });
});
