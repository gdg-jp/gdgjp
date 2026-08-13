import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireUser,
  runAuthHandler,
  approveDeviceCode,
  denyDeviceCode,
  findPendingDeviceCodeByUserCode,
  getFixedT,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  runAuthHandler: vi.fn(),
  approveDeviceCode: vi.fn(),
  denyDeviceCode: vi.fn(),
  findPendingDeviceCodeByUserCode: vi.fn(),
  getFixedT: vi.fn(async () => (key: string) => key),
}));

vi.mock("~/lib/auth.server", () => ({ requireUser, runAuthHandler }));
vi.mock("~/lib/device-authorization.server", () => ({
  approveDeviceCode,
  denyDeviceCode,
  findPendingDeviceCodeByUserCode,
}));
vi.mock("~/lib/i18n/i18n.server", () => ({ i18n: { getFixedT } }));

import { action, loader } from "./device";

const user = { id: "user-1", email: "u@example.com", name: "User", image: null, isAdmin: false };

function ctx() {
  return { cloudflare: { env: {} } } as never;
}

describe("device loader", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to sign-in when unauthenticated", async () => {
    requireUser.mockRejectedValue(new Response("Unauthorized", { status: 401 }));
    let thrown: unknown;
    try {
      await loader({
        request: new Request("https://accounts.example/device"),
        context: ctx(),
      } as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("location")).toContain("/signin");
  });

  it("returns no pending code when user_code is absent", async () => {
    requireUser.mockResolvedValue(user);
    const result = await loader({
      request: new Request("https://accounts.example/device"),
      context: ctx(),
    } as never);
    expect(result.pending).toBeNull();
    expect(findPendingDeviceCodeByUserCode).not.toHaveBeenCalled();
  });

  it("looks up the pending device code when user_code is present", async () => {
    requireUser.mockResolvedValue(user);
    findPendingDeviceCodeByUserCode.mockResolvedValue({
      id: "device-1",
      clientId: "gdg-cli",
      clientName: "GDG Japan CLI",
      scope: "openid",
    });
    const result = await loader({
      request: new Request("https://accounts.example/device?user_code=ABCD-1234"),
      context: ctx(),
    } as never);
    expect(findPendingDeviceCodeByUserCode).toHaveBeenCalledWith({}, "ABCD-1234");
    expect(result.pending?.id).toBe("device-1");
  });
});

describe("device action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to sign-in when unauthenticated", async () => {
    requireUser.mockRejectedValue(new Response("Unauthorized", { status: 401 }));
    const request = new Request("https://accounts.example/device", {
      method: "POST",
      body: new URLSearchParams({ id: "device-1", intent: "approve" }),
    });
    let thrown: unknown;
    try {
      await action({ request, context: ctx() } as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
  });

  it("denies the device code", async () => {
    requireUser.mockResolvedValue(user);
    const request = new Request("https://accounts.example/device", {
      method: "POST",
      body: new URLSearchParams({ id: "device-1", intent: "deny" }),
    });
    const result = await action({ request, context: ctx() } as never);
    expect(denyDeviceCode).toHaveBeenCalledWith({}, "device-1");
    expect(result).toEqual({ status: "denied" });
  });

  it("approves the device code and reports success", async () => {
    requireUser.mockResolvedValue(user);
    approveDeviceCode.mockResolvedValue(true);
    const request = new Request("https://accounts.example/device", {
      method: "POST",
      body: new URLSearchParams({ id: "device-1", intent: "approve" }),
    });
    const result = await action({ request, context: ctx() } as never);
    expect(approveDeviceCode).toHaveBeenCalledWith(
      {},
      request,
      "device-1",
      "user-1",
      runAuthHandler,
    );
    expect(result).toEqual({ status: "approved" });
  });

  it("reports failure when the bridge fails", async () => {
    requireUser.mockResolvedValue(user);
    approveDeviceCode.mockResolvedValue(false);
    const request = new Request("https://accounts.example/device", {
      method: "POST",
      body: new URLSearchParams({ id: "device-1", intent: "approve" }),
    });
    const result = await action({ request, context: ctx() } as never);
    expect(result).toEqual({ status: "failed" });
  });

  it("fails fast when id is missing", async () => {
    requireUser.mockResolvedValue(user);
    const request = new Request("https://accounts.example/device", {
      method: "POST",
      body: new URLSearchParams({ intent: "approve" }),
    });
    const result = await action({ request, context: ctx() } as never);
    expect(result).toEqual({ status: "failed" });
    expect(approveDeviceCode).not.toHaveBeenCalled();
  });
});
