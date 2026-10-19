/** Capture presets agreed for the MVP: camera 720p30, screen 1080p30, Opus 48 kHz. */

export const CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, max: 30 },
};

export const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 48000,
};

export type DeviceLists = {
  mics: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
};

export async function listDevices(): Promise<DeviceLists> {
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  return {
    mics: all.filter((d) => d.kind === "audioinput" && d.deviceId),
    cameras: all.filter((d) => d.kind === "videoinput" && d.deviceId),
    speakers: all.filter((d) => d.kind === "audiooutput" && d.deviceId),
  };
}

export type PermissionProblem = "denied" | "notFound" | "inUse" | "unknown";

export function permissionProblem(err: unknown): PermissionProblem {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "notFound";
  if (name === "NotReadableError" || name === "AbortError") return "inUse";
  return "unknown";
}

export async function openMic(deviceId?: string): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { ...MIC_CONSTRAINTS, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
  });
  const track = stream.getAudioTracks()[0];
  if (!track) throw new DOMException("no mic", "NotFoundError");
  return track;
}

export async function openCamera(deviceId?: string): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { ...CAMERA_CONSTRAINTS, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
  });
  const track = stream.getVideoTracks()[0];
  if (!track) throw new DOMException("no camera", "NotFoundError");
  track.contentHint = "motion";
  return track;
}

export type ScreenCapture = { video: MediaStreamTrack; audio: MediaStreamTrack | null };

/** Chrome/Edge's Conditional Focus handle (absent from older TS DOM typings). */
type FocusController = {
  setFocusBehavior: (behavior: "focus-captured-surface" | "no-focus-change") => void;
};

function captureController(): FocusController | null {
  const Ctor = (globalThis as { CaptureController?: new () => FocusController }).CaptureController;
  return Ctor ? new Ctor() : null;
}

/**
 * Must be called synchronously from a click handler (user activation).
 * Tab audio is requested; Safari/Firefox return video only.
 *
 * Chrome/Edge normally bring the shared tab or window to the front. Keep
 * screen.gdgs.jp in front instead, so the speaker still sees the room (cues,
 * timer) and can open the mini window; they switch to their slides themselves.
 */
export function startScreenShare(): Promise<ScreenCapture> {
  const controller = captureController();
  return navigator.mediaDevices
    .getDisplayMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // Chrome: offer "this tab" last and keep the picker focused on windows/screens.
      ...({ selfBrowserSurface: "exclude", surfaceSwitching: "include" } as object),
      ...(controller ? ({ controller } as object) : {}),
    } as DisplayMediaStreamOptions)
    .then((stream) => {
      // Has to run in the same task the promise resolves in, or Chrome has
      // already switched focus. Only tabs and windows can be held back.
      try {
        controller?.setFocusBehavior("no-focus-change");
      } catch {
        // A whole screen was shared; there is nothing to focus.
      }
      const video = stream.getVideoTracks()[0];
      if (!video) throw new DOMException("no video", "NotFoundError");
      video.contentHint = "detail";
      return { video, audio: stream.getAudioTracks()[0] ?? null };
    });
}

/** Safari and Firefox cannot share tab audio. */
export function canShareTabAudio(userAgent: string): boolean {
  if (/Firefox\//.test(userAgent)) return false;
  return /Chrome\/|Chromium\/|Edg\//.test(userAgent);
}

/** Chrome/Edge ship Document Picture-in-Picture. */
export function hasDocumentPip(): boolean {
  return typeof window !== "undefined" && "documentPictureInPicture" in window;
}

export function stopTrack(track: MediaStreamTrack | null | undefined) {
  try {
    track?.stop();
  } catch {
    // already stopped
  }
}
