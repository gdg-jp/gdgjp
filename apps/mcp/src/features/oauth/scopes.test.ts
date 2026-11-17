import { approvedScopes, defaultTicked } from "./scopes";

describe("approvedScopes", () => {
  it("always includes wiki:read and drops unknown scopes", () => {
    expect(approvedScopes([])).toEqual(["wiki:read"]);
    expect(approvedScopes(["wiki:write", "admin", "offline_access"])).toEqual([
      "wiki:read",
      "wiki:write",
    ]);
  });
});

describe("defaultTicked", () => {
  it("ticks everything when the client asked for nothing this server knows", () => {
    expect(defaultTicked([])).toEqual(["wiki:read", "wiki:write"]);
    expect(defaultTicked(["openid"])).toEqual(["wiki:read", "wiki:write"]);
  });

  it("keeps a read-only request read-only", () => {
    expect(defaultTicked(["wiki:read"])).toEqual(["wiki:read"]);
  });
});
