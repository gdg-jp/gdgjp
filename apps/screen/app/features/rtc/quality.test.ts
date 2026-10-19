import { describe, expect, it } from "vitest";
import { classifyLink, sampleFromStats } from "./quality";
import { isAllowedSfuCall } from "./sfu-proxy.server";

describe("link quality", () => {
  it("classifies by rtt, loss and bandwidth limits", () => {
    const base = { rtt: 0.05, loss: 0, bandwidthLimited: false, connected: true };
    expect(classifyLink(base)).toBe("good");
    expect(classifyLink({ ...base, rtt: 0.25 })).toBe("fair");
    expect(classifyLink({ ...base, bandwidthLimited: true })).toBe("fair");
    expect(classifyLink({ ...base, loss: 0.1 })).toBe("poor");
    expect(classifyLink({ ...base, connected: false })).toBe("poor");
  });

  it("reads the nominated pair, the worst remote loss and encoder limits", () => {
    const sample = sampleFromStats(
      [
        { type: "candidate-pair", nominated: true, state: "succeeded", currentRoundTripTime: 0.12 },
        { type: "candidate-pair", nominated: false, state: "failed", currentRoundTripTime: 9 },
        { type: "remote-inbound-rtp", fractionLost: 0.01 },
        { type: "remote-inbound-rtp", fractionLost: 0.03 },
        { type: "outbound-rtp", kind: "video", qualityLimitationReason: "bandwidth" },
      ],
      "connected",
    );
    expect(sample).toEqual({ rtt: 0.12, loss: 0.03, bandwidthLimited: true, connected: true });
  });
});

describe("SFU proxy allow-list", () => {
  it("passes only the session and track calls pages make", () => {
    expect(isAllowedSfuCall("POST", "sessions/new")).toBe(true);
    expect(isAllowedSfuCall("POST", "sessions/abc123/tracks/new")).toBe(true);
    expect(isAllowedSfuCall("PUT", "sessions/abc123/renegotiate")).toBe(true);
    expect(isAllowedSfuCall("PUT", "sessions/abc123/tracks/close")).toBe(true);
    expect(isAllowedSfuCall("GET", "sessions/abc123")).toBe(true);
    expect(isAllowedSfuCall("DELETE", "sessions/abc123")).toBe(false);
    expect(isAllowedSfuCall("POST", "sessions/../apps")).toBe(false);
    expect(isAllowedSfuCall("GET", "turn/credentials")).toBe(false);
  });
});
