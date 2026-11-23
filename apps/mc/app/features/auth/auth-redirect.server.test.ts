import { ClaimsUnavailableError } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
const fetchChaptersForUser = vi.fn();

vi.mock("~/features/auth/auth.server", () => ({
  getAuth: () => ({ getSessionUser }),
}));
vi.mock("~/features/auth/chapter.server", () => ({ fetchChaptersForUser }));

const { canUseController } = await import("./auth-redirect.server");

const env = {} as Env;
const request = new Request("https://mc.example/api/room/ws");
const user = { sub: "u1" };
const chapter = { id: 1, slug: "tokyo", role: "member" };

describe("canUseController", () => {
  beforeEach(() => {
    getSessionUser.mockReset();
    fetchChaptersForUser.mockReset();
  });

  it("admits a signed-in member", async () => {
    getSessionUser.mockResolvedValue(user);
    fetchChaptersForUser.mockResolvedValue({ primary: chapter, all: [chapter] });
    await expect(canUseController(env, request)).resolves.toBe(true);
  });

  it("rejects a request without a session", async () => {
    getSessionUser.mockResolvedValue(null);
    await expect(canUseController(env, request)).resolves.toBe(false);
    expect(fetchChaptersForUser).not.toHaveBeenCalled();
  });

  it("rejects a session the IdP no longer accepts", async () => {
    getSessionUser.mockRejectedValue(new Response(null, { status: 401 }));
    await expect(canUseController(env, request)).resolves.toBe(false);
  });

  it("keeps a signed-in operator connected while the IdP answers 503", async () => {
    getSessionUser.mockRejectedValue(new Response(null, { status: 503 }));
    await expect(canUseController(env, request)).resolves.toBe(true);
  });

  it("rejects an explicit answer that the user has no chapter", async () => {
    getSessionUser.mockResolvedValue(user);
    fetchChaptersForUser.mockResolvedValue({ primary: null, all: [] });
    await expect(canUseController(env, request)).resolves.toBe(false);
  });

  it("rejects when the IdP cannot vouch for the user's claims", async () => {
    getSessionUser.mockResolvedValue(user);
    fetchChaptersForUser.mockRejectedValue(new ClaimsUnavailableError("refresh_failed"));
    await expect(canUseController(env, request)).resolves.toBe(false);
  });

  it("keeps a signed-in operator connected when the chapter lookup cannot reach the IdP", async () => {
    getSessionUser.mockResolvedValue(user);
    fetchChaptersForUser.mockRejectedValue(new Response(null, { status: 503 }));
    await expect(canUseController(env, request)).resolves.toBe(true);
  });
});
