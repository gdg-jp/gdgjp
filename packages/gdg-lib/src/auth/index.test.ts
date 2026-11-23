import { describe, expect, it } from "vitest";
import {
  CHAPTERS_CLAIM,
  CHAPTERS_SCOPE,
  ClaimsUnavailableError,
  IS_ADMIN_CLAIM,
  RP_SESSION_PATH,
  SSO_PROVIDER_ID,
  SSO_SESSION_COOKIE,
  getSessionUser,
  isSuperAdmin,
  requireUser,
} from "./index";

function makeAuth(session: { user: Record<string, unknown> } | null) {
  return {
    api: {
      getSession: async () => session,
    },
  };
}

describe("wire contract with Accounts", () => {
  it("uses the scope, claim, cookie, and path names Accounts emits", () => {
    expect({
      CHAPTERS_SCOPE,
      CHAPTERS_CLAIM,
      IS_ADMIN_CLAIM,
      SSO_SESSION_COOKIE,
      RP_SESSION_PATH,
      SSO_PROVIDER_ID,
    }).toEqual({
      CHAPTERS_SCOPE: "https://gdgs.jp/scopes/chapters",
      CHAPTERS_CLAIM: "https://gdgs.jp/claims/chapters",
      IS_ADMIN_CLAIM: "https://gdgs.jp/claims/is_admin",
      SSO_SESSION_COOKIE: "gdg_sid",
      RP_SESSION_PATH: "/api/rp/v1/session",
      SSO_PROVIDER_ID: "gdgjp",
    });
  });
});

describe("getSessionUser", () => {
  it("maps a session user to an AuthUser", async () => {
    const auth = makeAuth({
      user: {
        id: "u_1",
        email: "ada@example.com",
        name: "Ada Lovelace",
        image: "https://example.com/ada.png",
        isAdmin: false,
      },
    });
    const result = await getSessionUser(auth, new Request("https://x.example/"));
    expect(result).toEqual({
      id: "u_1",
      email: "ada@example.com",
      name: "Ada Lovelace",
      image: "https://example.com/ada.png",
      isAdmin: false,
    });
  });

  it("defaults missing strings to empty and a non-string image to null", async () => {
    const result = await getSessionUser(
      makeAuth({ user: { image: 7 } }),
      new Request("https://x.example/"),
    );
    expect(result).toEqual({ id: "", email: "", name: "", image: null, isAdmin: false });
  });

  it("treats isAdmin true or 1 (SQLite boolean) as admin", async () => {
    for (const isAdmin of [true, 1]) {
      const auth = makeAuth({ user: { id: "u_2", email: "a@b.c", name: "A", isAdmin } });
      const result = await getSessionUser(auth, new Request("https://x.example/"));
      expect(result?.isAdmin).toBe(true);
    }
  });
});

describe("requireUser", () => {
  it("throws a 401 Response when unauthenticated", async () => {
    const rejected = await requireUser(makeAuth(null), new Request("https://x.example/")).catch(
      (error: unknown) => error,
    );
    expect(rejected).toBeInstanceOf(Response);
    expect((rejected as Response).status).toBe(401);
    expect(await (rejected as Response).text()).toBe("Unauthorized");
  });

  it("returns the AuthUser when authenticated", async () => {
    const auth = makeAuth({
      user: { id: "u_3", email: "g@h.i", name: "Grace", isAdmin: false },
    });
    const result = await requireUser(auth, new Request("https://x.example/"));
    expect(result.email).toBe("g@h.i");
  });
});

describe("ClaimsUnavailableError", () => {
  it("names its reason and keeps a cause only when one is given", () => {
    const cause = new Error("upstream");
    const withCause = new ClaimsUnavailableError("refresh_failed", cause);
    expect(withCause).toMatchObject({
      name: "ClaimsUnavailableError",
      message: "claims unavailable: refresh_failed",
      reason: "refresh_failed",
      cause,
    });
    expect("cause" in new ClaimsUnavailableError("no_linked_account")).toBe(false);
  });
});

describe("isSuperAdmin", () => {
  it("returns true when isAdmin is true", () => {
    expect(isSuperAdmin({ id: "u", email: "e", name: "n", image: null, isAdmin: true })).toBe(true);
  });

  it("returns false when isAdmin is false", () => {
    expect(isSuperAdmin({ id: "u", email: "e", name: "n", image: null, isAdmin: false })).toBe(
      false,
    );
  });
});
