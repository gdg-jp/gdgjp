import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/auth", () => ({
  auth: async () => ({
    accessToken: "kwansai-access-token",
    user: { chapters: [{ chapterId: 7, chapterSlug: "gdg-kwansai", role: "organizer" }] },
    expires: "2099-01-01T00:00:00.000Z",
  }),
  canUseQrScanner: () => true,
}));

const upstream = vi.fn<typeof fetch>();

function checkIn(body: string) {
  return POST(
    new NextRequest("http://localhost:3000/api/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  );
}

beforeEach(() => {
  upstream.mockReset();
  upstream.mockResolvedValue(Response.json({ checkedIn: true, userId: "alice", reason: null }));
  vi.stubGlobal("fetch", upstream);
  vi.stubEnv("CONNPASS_URL", "https://connpass.gdgs.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/checkin", () => {
  it.each([
    ["a foreign host", "https://evil.example/event/123/qr_checkin/45/67/"],
    ["a lookalike suffix host", "https://connpass.com.evil.example/event/123/qr_checkin/45/67/"],
    ["a lookalike prefix host", "https://evilconnpass.com/event/123/qr_checkin/45/67/"],
    ["userinfo before a foreign host", "https://connpass.com@evil.example/"],
    ["userinfo before connpass", "https://evil.example@connpass.com/event/123/qr_checkin/45/67/"],
    ["an explicit port", "https://connpass.com:8443/event/123/qr_checkin/45/67/"],
    ["a trailing-dot host", "https://connpass.com./event/123/qr_checkin/45/67/"],
    ["a percent-encoded host", "https://connpass%2Ecom.evil.example/event/123/qr_checkin/45/67/"],
    ["a backslash host", "https:\\\\evil.example\\connpass.com/event/123/qr_checkin/45/67/"],
    ["plain http", "http://connpass.com/event/123/qr_checkin/45/67/"],
    ["another scheme", "javascript:alert(1)//connpass.com/event/123/qr_checkin/45/67/"],
    ["a relative URL", "/event/123/qr_checkin/45/67/"],
    ["an event page", "https://connpass.com/event/123/"],
    ["an extra path segment", "https://connpass.com/event/123/qr_checkin/45/67/edit/"],
    [
      "a dot-segment escape",
      "https://connpass.com/event/123/qr_checkin/45/67/../../../../settings/",
    ],
    ["an encoded slash", "https://connpass.com/event/123/qr_checkin/45/67%2F..%2F..%2Fsettings"],
    [
      "a query string",
      "https://connpass.com/event/123/qr_checkin/45/67/?next=https://evil.example",
    ],
    ["a fragment", "https://connpass.com/event/123/qr_checkin/45/67/#x"],
    ["a Luma URL without a proxy key", "https://luma.com/check-in/evt-ABC123"],
    ["a Luma URL with a bad proxy key", "https://luma.com/check-in/evt-ABC123?pk=../../x"],
    ["a Luma lookalike host", "https://luma.com.evil.example/check-in/evt-ABC123?pk=g-XYZ"],
    ["a legacy Luma lookalike host", "https://lu.ma.evil.example/check-in/evt-ABC123?pk=g-XYZ"],
    ["a Luma page that is not a check-in", "https://luma.com/event/evt-ABC123?pk=g-XYZ"],
  ])("rejects %s without calling connpass", async (_, url) => {
    const response = await checkIn(JSON.stringify({ url }));

    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing url", JSON.stringify({})],
    ["a non-string url", JSON.stringify({ url: 123 })],
    ["a JSON string body", JSON.stringify("https://connpass.com/event/123/qr_checkin/45/67/")],
    ["a malformed body", "{"],
  ])("rejects %s without calling connpass", async (_, body) => {
    const response = await checkIn(body);

    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards a connpass reception QR URL with the session's token", async () => {
    const response = await checkIn(
      JSON.stringify({ url: " https://connpass.com/event/123/qr_checkin/45/67 " }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ checkedIn: true, userId: "alice", reason: null });
    expect(upstream).toHaveBeenCalledTimes(1);
    const [target, init] = upstream.mock.calls[0];
    expect(target).toBe("https://connpass.gdgs.test/api/checkin");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer kwansai-access-token");
    expect(JSON.parse(String(init?.body))).toEqual({
      url: "https://connpass.com/event/123/qr_checkin/45/67/",
    });
  });

  it("forwards a Luma ticket URL reduced to its proxy key", async () => {
    const response = await checkIn(
      JSON.stringify({ url: "https://luma.com/check-in/evt-ABC123?pk=g-XYZ789&utm_source=qr" }),
    );

    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(upstream.mock.calls[0][1]?.body))).toEqual({
      url: "https://luma.com/check-in/evt-ABC123?pk=g-XYZ789",
    });
  });

  it("accepts a ticket on Luma's legacy lu.ma host and forwards it as luma.com", async () => {
    const response = await checkIn(
      JSON.stringify({ url: "https://lu.ma/check-in/evt-ABC123?pk=g-XYZ789" }),
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(String(upstream.mock.calls[0][1]?.body))).toEqual({
      url: "https://luma.com/check-in/evt-ABC123?pk=g-XYZ789",
    });
  });
});
