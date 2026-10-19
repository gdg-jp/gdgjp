import { useEffect, useRef } from "react";

/** A muted, autoplaying <video> bound to one track (null shows nothing). */
export function TrackVideo({
  track,
  mirror = false,
  fit = "contain",
  className,
  label,
  holdLastFrame = false,
}: {
  track: MediaStreamTrack | null;
  mirror?: boolean;
  fit?: "contain" | "cover";
  className?: string;
  label?: string;
  /** Keep showing the last frame when the track goes away (OBS outputs). */
  holdLastFrame?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!track) {
      if (!holdLastFrame) el.srcObject = null;
      return;
    }
    el.srcObject = new MediaStream([track]);
    void el.play().catch(() => undefined);
  }, [track, holdLastFrame]);
  return (
    <video
      ref={ref}
      className={className}
      autoPlay
      playsInline
      muted
      aria-label={label}
      style={{
        objectFit: fit,
        transform: mirror ? "scaleX(-1)" : undefined,
      }}
    />
  );
}

/** Plays one remote audio track, optionally on a chosen output device. */
export function TrackAudio({
  track,
  muted = false,
  sinkId,
}: {
  track: MediaStreamTrack | null;
  muted?: boolean;
  sinkId?: string;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = track ? new MediaStream([track]) : null;
    if (track) void el.play().catch(() => undefined);
  }, [track]);
  useEffect(() => {
    const el = ref.current as
      | (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> })
      | null;
    if (el?.setSinkId && sinkId !== undefined) void el.setSinkId(sinkId).catch(() => undefined);
  }, [sinkId]);
  return <audio ref={ref} autoPlay muted={muted} />;
}
