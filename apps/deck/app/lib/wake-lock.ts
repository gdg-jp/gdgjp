import { useEventListener, useMountEffect } from "@gdgjp/gdg-lib/react";
import { useRef } from "react";

type WakeLockSentinelLike = { release: () => Promise<void> };
type WakeLockLike = { request: (type: "screen") => Promise<WakeLockSentinelLike> };

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return null;
  return (navigator as Navigator & { wakeLock: WakeLockLike }).wakeLock;
}

export function useWakeLock() {
  const active = useRef(false);
  const sentinel = useRef<WakeLockSentinelLike | null>(null);
  const acquire = () => {
    const wakeLock = wakeLockApi();
    if (!wakeLock || !active.current || document.visibilityState !== "visible") return;
    wakeLock
      .request("screen")
      .then((s) => {
        if (active.current) sentinel.current = s;
        else void s.release();
      })
      .catch(() => {});
  };
  useEventListener("document", "visibilitychange", acquire);
  useMountEffect(() => {
    active.current = true;
    acquire();
    return () => {
      active.current = false;
      void sentinel.current?.release();
      sentinel.current = null;
    };
  });
}
