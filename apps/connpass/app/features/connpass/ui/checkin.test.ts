import { describe, expect, it } from "vitest";
import { parseCheckinUrl } from "./checkin";

describe("parseCheckinUrl", () => {
  it("accepts a connpass reception QR URL", () => {
    expect(parseCheckinUrl("https://connpass.com/event/388434/qr_checkin/831287/7082717/")).toEqual(
      {
        url: "https://connpass.com/event/388434/qr_checkin/831287/7082717/",
        eventId: "388434",
      },
    );
  });

  it("normalizes a missing trailing slash and drops query and fragment", () => {
    expect(parseCheckinUrl(" https://connpass.com/event/1/qr_checkin/2/3?x=1#y ")).toEqual({
      url: "https://connpass.com/event/1/qr_checkin/2/3/",
      eventId: "1",
    });
  });

  it.each([
    undefined,
    42,
    "not a url",
    "http://connpass.com/event/1/qr_checkin/2/3/",
    "https://evil.example/event/1/qr_checkin/2/3/",
    "https://gdg-tokyo.connpass.com/event/1/qr_checkin/2/3/",
    "https://user:pass@connpass.com/event/1/qr_checkin/2/3/",
    "https://connpass.com:8443/event/1/qr_checkin/2/3/",
    "https://connpass.com/event/1/",
    "https://connpass.com/event/1/qr_checkin/2/",
    "https://connpass.com/event/1/qr_checkin/2/3/extra/",
  ])("rejects %s", (raw) => {
    expect(parseCheckinUrl(raw)).toBeNull();
  });
});
