import { useEffect, useState } from "react";

let sharedContext: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  if (!sharedContext) sharedContext = new AudioContext();
  if (sharedContext.state === "suspended") void sharedContext.resume().catch(() => undefined);
  return sharedContext;
}

/** RMS level → 0..1 on a perceptual (dB) scale. */
export function levelFromRms(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db + 60) / 50));
}

/** Live 0..1 input level of an audio track, sampled ~12 times a second. */
export function useLevel(track: MediaStreamTrack | null, active = true): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!track || !active || track.kind !== "audio") {
      setLevel(0);
      return;
    }
    const ctx = audioContext();
    if (!ctx) return;
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const timer = setInterval(() => {
      if (!track.enabled) {
        setLevel(0);
        return;
      }
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      setLevel(levelFromRms(Math.sqrt(sum / buf.length)));
    }, 80);
    return () => {
      clearInterval(timer);
      source.disconnect();
    };
  }, [track, active]);
  return level;
}
