import { describe, expect, it } from "vitest";
import { isCheckInForEvent, parseCheckInUrl } from "./checkin-url";

describe("parseCheckInUrl", () => {
  it("reads the event of a connpass reception QR and canonicalises its URL", () => {
    expect(parseCheckInUrl("https://CONNPASS.com/event/123/qr_checkin/45/67")).toEqual({
      kind: "connpass",
      eventId: "123",
      url: "https://connpass.com/event/123/qr_checkin/45/67/",
    });
  });

  it("keeps only the proxy key of a Luma ticket", () => {
    expect(parseCheckInUrl("https://luma.com/check-in/evt-AB12/?pk=g-CD34&x=1")).toEqual({
      kind: "luma",
      url: "https://luma.com/check-in/evt-AB12?pk=g-CD34",
    });
  });
});

describe("isCheckInForEvent", () => {
  it("accepts a connpass QR only for the configured event and Luma tickets for any event", () => {
    const connpass = parseCheckInUrl("https://connpass.com/event/123/qr_checkin/45/67/");
    const luma = parseCheckInUrl("https://luma.com/check-in/evt-AB12?pk=g-CD34");
    if (!connpass || !luma) throw new Error("fixtures must parse");

    expect(isCheckInForEvent(connpass, "123")).toBe(true);
    expect(isCheckInForEvent(connpass, "999")).toBe(false);
    expect(isCheckInForEvent(connpass, "")).toBe(false);
    expect(isCheckInForEvent(luma, "123")).toBe(true);
  });
});
