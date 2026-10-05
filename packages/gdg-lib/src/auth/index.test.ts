import { describe, expect, it } from "vitest";
import { getSessionUser, isSuperAdmin, requireUser } from "./index";

function makeAuth(session: { user: Record<string, unknown> } | null) {
  return {
    api: {
      getSession: async () => session,
    },
  };
}

describe("getSessionUser", () => {
  it("returns null when there is no session", async () => {
    const result = await getSessionUser(makeAuth(null), new Request("https://x.example/"));
    expect(result).toBeNull();
  });

  it("maps a session user to an AuthUser", async () => {
    const auth = makeAuth({
      user: {
        id: "u_1",
        email: "ada@example.com",
        name: "Ada Lovelace",
        isAdmin: false,
      },
    });
    const result = await getSessionUser(auth, new Request("https://x.example/"));
    expect(result).toEqual({
      id: "u_1",
      email: "ada@example.com",
      name: "Ada Lovelace",
      image: null,
      isAdmin: false,
    });
  });

  it("treats isAdmin === 1 as admin (SQLite boolean)", async () => {
    const auth = makeAuth({
      user: { id: "u_2", email: "a@b.c", name: "A", isAdmin: 1 },
    });
    const result = await getSessionUser(auth, new Request("https://x.example/"));
    expect(result?.isAdmin).toBe(true);
  });
});

describe("requireUser", () => {
  it("throws a 401 Response when unauthenticated", async () => {
    const promise = requireUser(makeAuth(null), new Request("https://x.example/"));
    await expect(promise).rejects.toBeInstanceOf(Response);
    await promise.catch((res: Response) => {
      expect(res.status).toBe(401);
    });
  });

  it("returns the AuthUser when authenticated", async () => {
    const auth = makeAuth({
      user: { id: "u_3", email: "g@h.i", name: "Grace", isAdmin: false },
    });
    const result = await requireUser(auth, new Request("https://x.example/"));
    expect(result.email).toBe("g@h.i");
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
