import { describe, expect, it } from "vitest";
import { scopeLabelKeys, splitScopeParameter } from "~/features/oauth/scope-labels";

describe("scopeLabelKeys", () => {
  it("maps each known scope to its plain-language label in request order", () => {
    expect(
      scopeLabelKeys([
        "https://gdgs.jp/scopes/chapters",
        "openid",
        "email",
        "profile",
        "offline_access",
      ]),
    ).toEqual([
      "auth.consent.scope.chapters",
      "auth.consent.scope.openid",
      "auth.consent.scope.email",
      "auth.consent.scope.profile",
      "auth.consent.scope.offline_access",
    ]);
  });

  it("adds one unknown label after the known ones and removes duplicates", () => {
    expect(
      scopeLabelKeys(["custom", "openid", "openid", "constructor", "https://gdgs.jp/scopes/cli"]),
    ).toEqual(["auth.consent.scope.openid", "auth.consent.scope.unknown"]);
  });

  it("returns no labels for no scopes", () => {
    expect(scopeLabelKeys([])).toEqual([]);
  });
});

describe("splitScopeParameter", () => {
  it("splits on any whitespace and drops empty entries", () => {
    expect(splitScopeParameter("  openid\temail  profile\n")).toEqual([
      "openid",
      "email",
      "profile",
    ]);
  });

  it.each([null, ""])("returns no scopes for %o", (value) => {
    expect(splitScopeParameter(value)).toEqual([]);
  });
});
