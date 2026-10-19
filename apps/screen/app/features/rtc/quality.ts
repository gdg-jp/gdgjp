import type { Quality } from "~/features/stage/protocol";

export type LinkSample = {
  /** Seconds, from the selected candidate pair. */
  rtt: number | null;
  /** 0..1 packet loss the SFU reports for what we send. */
  loss: number | null;
  /** The encoder is held back by bandwidth. */
  bandwidthLimited: boolean;
  connected: boolean;
};

export function classifyLink(sample: LinkSample): Quality {
  if (!sample.connected) return "poor";
  const rtt = sample.rtt ?? 0;
  const loss = sample.loss ?? 0;
  if (rtt > 0.4 || loss > 0.08) return "poor";
  if (rtt > 0.2 || loss > 0.02 || sample.bandwidthLimited) return "fair";
  return "good";
}

type StatLike = Record<string, unknown> & { type: string };

/** Reduce a getStats() report to the numbers classifyLink needs. */
export function sampleFromStats(stats: Iterable<StatLike>, iceState: string): LinkSample {
  let rtt: number | null = null;
  const losses: number[] = [];
  let bandwidthLimited = false;
  for (const s of stats) {
    if (s.type === "candidate-pair" && s.nominated && s.state === "succeeded") {
      if (typeof s.currentRoundTripTime === "number") rtt = s.currentRoundTripTime;
    } else if (s.type === "remote-inbound-rtp" && typeof s.fractionLost === "number") {
      losses.push(s.fractionLost);
    } else if (
      s.type === "outbound-rtp" &&
      s.kind === "video" &&
      s.qualityLimitationReason === "bandwidth"
    ) {
      bandwidthLimited = true;
    }
  }
  return {
    rtt,
    loss: losses.length > 0 ? Math.max(...losses) : null,
    bandwidthLimited,
    connected: iceState === "connected" || iceState === "completed",
  };
}
