import { useEffect, useRef, useState } from "react";
import type { SfuManager } from "./sfu-manager";

const STATS_MS = 2000;

/** The inbound-rtp fields the debug readout needs. */
export type InboundSample = {
  trackIdentifier: string;
  bytesReceived: number;
  /** ms */
  timestamp: number;
  frameWidth?: number;
  frameHeight?: number;
};

export type ReceiveRate = {
  kbps: number;
  /** "1280x720"; the received size tells which simulcast layer arrives. */
  size: string | null;
};

export function inboundSamples(stats: Iterable<Record<string, unknown>>): InboundSample[] {
  const out: InboundSample[] = [];
  for (const s of stats) {
    if (s.type !== "inbound-rtp") continue;
    if (typeof s.trackIdentifier !== "string" || typeof s.bytesReceived !== "number") continue;
    out.push({
      trackIdentifier: s.trackIdentifier,
      bytesReceived: s.bytesReceived,
      timestamp: typeof s.timestamp === "number" ? s.timestamp : 0,
      frameWidth: typeof s.frameWidth === "number" ? s.frameWidth : undefined,
      frameHeight: typeof s.frameHeight === "number" ? s.frameHeight : undefined,
    });
  }
  return out;
}

/** Per receiver track id: bitrate between two samples, plus the latest frame size. */
export function receiveRates(
  prev: ReadonlyMap<string, InboundSample>,
  next: InboundSample[],
): Map<string, ReceiveRate> {
  const rates = new Map<string, ReceiveRate>();
  for (const s of next) {
    const before = prev.get(s.trackIdentifier);
    const ms = before ? s.timestamp - before.timestamp : 0;
    const kbps =
      before && ms > 0 ? Math.round(((s.bytesReceived - before.bytesReceived) * 8) / ms) : 0;
    const size = s.frameWidth && s.frameHeight ? `${s.frameWidth}x${s.frameHeight}` : null;
    rates.set(s.trackIdentifier, { kbps: Math.max(0, kbps), size });
  }
  return rates;
}

/**
 * Debug only: what each pulled track actually costs, keyed like
 * `snapshot.remote` (remoteKey). Off unless `enabled`.
 */
export function useReceiveStats(
  manager: SfuManager | null,
  remote: ReadonlyMap<string, MediaStreamTrack>,
  enabled: boolean,
): Map<string, ReceiveRate> {
  const [rates, setRates] = useState<Map<string, ReceiveRate>>(new Map());
  // Read at each tick so a changing pull set does not restart the sampling.
  const remoteRef = useRef(remote);
  remoteRef.current = remote;
  useEffect(() => {
    if (!enabled || !manager) return;
    let prev = new Map<string, InboundSample>();
    const timer = setInterval(async () => {
      const stats = await manager.connection?.stats();
      if (!stats) return;
      const samples = inboundSamples(stats.values() as Iterable<Record<string, unknown>>);
      const byTrack = receiveRates(prev, samples);
      prev = new Map(samples.map((s) => [s.trackIdentifier, s]));
      const byKey = new Map<string, ReceiveRate>();
      for (const [key, track] of remoteRef.current) {
        const rate = byTrack.get(track.id);
        if (rate) byKey.set(key, rate);
      }
      setRates(byKey);
    }, STATS_MS);
    return () => clearInterval(timer);
  }, [manager, enabled]);
  return rates;
}

/** remoteKey → "812 kbps 1280x720" for a debug readout. */
export function describeRates(
  remote: ReadonlyMap<string, MediaStreamTrack>,
  rates: ReadonlyMap<string, ReceiveRate>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of remote.keys()) {
    const rate = rates.get(key);
    out[key] = rate ? `${rate.kbps} kbps${rate.size ? ` ${rate.size}` : ""}` : "…";
  }
  return out;
}
