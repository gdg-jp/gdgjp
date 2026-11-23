import { describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => vi.fn(async () => ({ sub: "u" })));
vi.mock("~/features/auth/bearer.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/features/auth/bearer.server")>()),
  connpassIdentity: identity,
}));
vi.mock("~/features/auth/authorize.server", () => ({
  canWriteAnyGroup: async () => true,
  canWriteGroup: () => true,
  getAllowedLumaCalendar: async () => null,
}));
const fast = vi.fn();
vi.mock("~/features/connpass/checkin-fetch.server", () => ({ checkInWithFetch: () => fast() }));
vi.mock("~/features/connpass/connpass-browser-read.server", () => ({ checkInInBrowser: vi.fn() }));

import { action } from "./checkin";

const promo = new Map([["Nisss78", "AIHACKATHON"]]);
const env = { PROMO_USERS_KV: { get: async (k: string) => promo.get(k) ?? null } };

async function call(): Promise<{ checkedIn: boolean; promoCode: string | null }> {
  const request = new Request("http://x/api/checkin", {
    method: "POST",
    body: JSON.stringify({ url: "https://connpass.com/event/1/qr_checkin/2/3/" }),
  });
  const res = await action({ request, context: { cloudflare: { env } } } as never);
  return (await (res as Response).json()) as Awaited<ReturnType<typeof call>>;
}

describe("checkin client trust", () => {
  it("lets only the configured check-in clients write through a developer app", async () => {
    fast.mockResolvedValue({ checkedIn: true, userId: null, reason: null });
    const request = new Request("http://x/api/checkin", {
      method: "POST",
      body: JSON.stringify({ url: "https://connpass.com/event/1/qr_checkin/2/3/" }),
    });
    await action({
      request,
      context: { cloudflare: { env: { ...env, CHECKIN_CLIENT_IDS: " qr-app ,other " } } },
    } as never);

    expect(identity).toHaveBeenCalledWith(request, expect.anything(), ["qr-app", "other"]);
  });
});

describe("checkin promoCode", () => {
  it("returns the promo code for a registered user", async () => {
    fast.mockResolvedValue({ checkedIn: true, userId: "Nisss78", reason: null });
    expect(await call()).toMatchObject({ checkedIn: true, promoCode: "AIHACKATHON" });
  });
  it("returns null for an unregistered user", async () => {
    fast.mockResolvedValue({ checkedIn: true, userId: "nobody", reason: null });
    expect((await call()).promoCode).toBeNull();
  });
  it("returns null when not checked in", async () => {
    fast.mockResolvedValue({ checkedIn: false, userId: "Nisss78", reason: "already_checked_in" });
    expect((await call()).promoCode).toBeNull();
  });
});
