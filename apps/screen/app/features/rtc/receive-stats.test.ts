import { describe, expect, it } from "vitest";
import { type InboundSample, inboundSamples, receiveRates } from "./receive-stats";

describe("receiveRates", () => {
  it("turns byte deltas into kbps and reports the frame size", () => {
    const prev = new Map<string, InboundSample>([
      ["cam", { trackIdentifier: "cam", bytesReceived: 0, timestamp: 1000 }],
    ]);
    const rates = receiveRates(prev, [
      {
        trackIdentifier: "cam",
        bytesReceived: 250_000,
        timestamp: 3000,
        frameWidth: 320,
        frameHeight: 180,
      },
      { trackIdentifier: "mic", bytesReceived: 9000, timestamp: 3000 },
    ]);
    expect(rates.get("cam")).toEqual({ kbps: 1000, size: "320x180" });
    // No earlier sample yet.
    expect(rates.get("mic")).toEqual({ kbps: 0, size: null });
  });
});

describe("inboundSamples", () => {
  it("keeps inbound-rtp entries only", () => {
    const samples = inboundSamples([
      { type: "inbound-rtp", trackIdentifier: "a", bytesReceived: 10, timestamp: 5 },
      { type: "outbound-rtp", trackIdentifier: "b", bytesSent: 10 },
      { type: "inbound-rtp", bytesReceived: 10 },
    ]);
    expect(samples).toEqual([
      {
        trackIdentifier: "a",
        bytesReceived: 10,
        timestamp: 5,
        frameWidth: undefined,
        frameHeight: undefined,
      },
    ]);
  });
});
