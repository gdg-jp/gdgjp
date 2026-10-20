import { useCallback, useEffect, useRef, useState } from "react";
import { preloadDenoise } from "./denoise/use-denoise";
import {
  type DeviceLists,
  MIC_CONSTRAINTS,
  type PermissionProblem,
  type ScreenCapture,
  listDevices,
  openCamera,
  openMic,
  permissionProblem,
  startScreenShare,
  stopTrack,
} from "./media";

const PREFS_KEY = "screen-devices";

type Prefs = {
  micId?: string;
  camId?: string;
  speakerId?: string;
  micOn?: boolean;
  speakerOn?: boolean;
  camOn?: boolean;
  /** Operators' camera choice, kept apart so a speaker's "on" never carries over. */
  opCamOn?: boolean;
};

function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Prefs;
  } catch {
    return {};
  }
}

function writePrefs(patch: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    // private mode
  }
}

export type LocalMedia = {
  mic: MediaStreamTrack | null;
  camera: MediaStreamTrack | null;
  screen: ScreenCapture | null;
  micOn: boolean;
  /** Incoming audio (operators / speakers) plays; off mutes it locally. */
  speakerOn: boolean;
  camOn: boolean;
  micId: string;
  camId: string;
  speakerId: string;
  devices: DeviceLists;
  problem: { mic: PermissionProblem | null; camera: PermissionProblem | null };
  /** Set when the browser's own "stop sharing" ended the capture. */
  screenEndedByBrowser: boolean;
  toggleMic: () => void;
  toggleSpeaker: () => void;
  toggleCam: () => void;
  setMicEnabled: (on: boolean) => void;
  /** The browser's own noise suppression on the mic (off while DeepFilterNet3 runs). */
  setBrowserNoiseSuppression: (on: boolean) => void;
  selectMic: (id: string) => void;
  selectCam: (id: string) => void;
  selectSpeaker: (id: string) => void;
  /** Call straight from a click handler. Resolves false if the user cancelled. */
  shareScreen: () => Promise<boolean>;
  stopScreen: () => void;
  retry: () => void;
};

const EMPTY_DEVICES: DeviceLists = { mics: [], cameras: [], speakers: [] };

/**
 * The page's own mic, camera and screen capture. The mic stays open while
 * muted (muting only disables the track) so unmuting is instant; turning the
 * camera off releases it so the camera light goes out.
 *
 * Operators start with the camera off: every speaker pulls it, so an unused
 * operator camera is SFU egress times the number of speakers.
 */
export function useLocalMedia(
  enabled = true,
  role: "speaker" | "operator" = "speaker",
): LocalMedia {
  const camPref = role === "operator" ? "opCamOn" : "camOn";
  const [mic, setMic] = useState<MediaStreamTrack | null>(null);
  const [camera, setCamera] = useState<MediaStreamTrack | null>(null);
  const [screen, setScreen] = useState<ScreenCapture | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [camOn, setCamOn] = useState(role === "speaker");
  const [micId, setMicId] = useState("");
  const [camId, setCamId] = useState("");
  const [speakerId, setSpeakerId] = useState("");
  const [devices, setDevices] = useState<DeviceLists>(EMPTY_DEVICES);
  const [problem, setProblem] = useState<LocalMedia["problem"]>({ mic: null, camera: null });
  const [screenEndedByBrowser, setScreenEndedByBrowser] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [browserNs, setBrowserNs] = useState(true);
  const browserNsRef = useRef(true);
  browserNsRef.current = browserNs;
  const [nsReopen, setNsReopen] = useState(0);
  const reopenedFor = useRef<boolean | null>(null);
  const loaded = useRef(false);

  // Restore remembered choices once on the client.
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const prefs = readPrefs();
    if (prefs.micId) setMicId(prefs.micId);
    if (prefs.camId) setCamId(prefs.camId);
    if (prefs.speakerId) setSpeakerId(prefs.speakerId);
    if (typeof prefs.micOn === "boolean") setMicOn(prefs.micOn);
    if (typeof prefs.speakerOn === "boolean") setSpeakerOn(prefs.speakerOn);
    const savedCam = prefs[camPref];
    if (typeof savedCam === "boolean") setCamOn(savedCam);
  }, [camPref]);

  const refreshDevices = useCallback(() => {
    void listDevices().then(setDevices);
  }, []);

  useEffect(() => {
    if (enabled) preloadDenoise();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    refreshDevices();
    navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", refreshDevices);
  }, [enabled, refreshDevices]);

  // Mic: open for the chosen device; reopen on change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt and nsReopen force a reopen
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let opened: MediaStreamTrack | null = null;
    openMic(micId || undefined, browserNsRef.current)
      .then((track) => {
        if (cancelled) return stopTrack(track);
        opened = track;
        setMic(track);
        setProblem((p) => ({ ...p, mic: null }));
        refreshDevices();
      })
      .catch((err) => {
        if (!cancelled) setProblem((p) => ({ ...p, mic: permissionProblem(err) }));
      });
    return () => {
      cancelled = true;
      stopTrack(opened);
      setMic(null);
    };
  }, [enabled, micId, attempt, nsReopen, refreshDevices]);

  useEffect(() => {
    if (mic) mic.enabled = micOn;
  }, [mic, micOn]);

  // Switch the browser's suppression in place; browsers that ignore the
  // change (getSettings disagrees) get the mic reopened once, a short gap.
  useEffect(() => {
    if (!mic || mic.getSettings().noiseSuppression === browserNs) return;
    let cancelled = false;
    const { sampleRate: _rate, ...constraints } = MIC_CONSTRAINTS;
    mic
      .applyConstraints({ ...constraints, noiseSuppression: browserNs })
      .catch(() => {})
      .then(() => {
        if (cancelled) return;
        const now = mic.getSettings().noiseSuppression;
        if (now === undefined || now === browserNs || reopenedFor.current === browserNs) return;
        reopenedFor.current = browserNs;
        setNsReopen((n) => n + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [mic, browserNs]);

  // Camera: only open while on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt forces a retry
  useEffect(() => {
    if (!enabled || !camOn) return;
    let cancelled = false;
    let opened: MediaStreamTrack | null = null;
    openCamera(camId || undefined)
      .then((track) => {
        if (cancelled) return stopTrack(track);
        opened = track;
        setCamera(track);
        setProblem((p) => ({ ...p, camera: null }));
        refreshDevices();
      })
      .catch((err) => {
        if (!cancelled) setProblem((p) => ({ ...p, camera: permissionProblem(err) }));
      });
    return () => {
      cancelled = true;
      stopTrack(opened);
      setCamera(null);
    };
  }, [enabled, camOn, camId, attempt, refreshDevices]);

  const screenRef = useRef<ScreenCapture | null>(null);
  screenRef.current = screen;

  const stopScreen = useCallback(() => {
    const current = screenRef.current;
    stopTrack(current?.video);
    stopTrack(current?.audio);
    setScreen(null);
  }, []);

  const shareScreen = useCallback(async () => {
    try {
      const capture = await startScreenShare();
      const old = screenRef.current;
      stopTrack(old?.video);
      stopTrack(old?.audio);
      capture.video.addEventListener("ended", () => {
        if (screenRef.current?.video !== capture.video) return;
        stopTrack(capture.audio);
        setScreen(null);
        setScreenEndedByBrowser(true);
      });
      setScreenEndedByBrowser(false);
      setScreen(capture);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => () => stopScreen(), [stopScreen]);

  return {
    mic,
    camera,
    screen,
    micOn,
    speakerOn,
    camOn,
    micId,
    camId,
    speakerId,
    devices,
    problem,
    screenEndedByBrowser,
    toggleSpeaker: () =>
      setSpeakerOn((on) => {
        writePrefs({ speakerOn: !on });
        return !on;
      }),
    toggleMic: () =>
      setMicOn((on) => {
        writePrefs({ micOn: !on });
        return !on;
      }),
    toggleCam: () =>
      setCamOn((on) => {
        writePrefs({ [camPref]: !on });
        return !on;
      }),
    setMicEnabled: (on: boolean) => setMicOn(on),
    setBrowserNoiseSuppression: setBrowserNs,
    selectMic: (id) => {
      writePrefs({ micId: id });
      setMicId(id);
    },
    selectCam: (id) => {
      writePrefs({ camId: id });
      setCamId(id);
    },
    selectSpeaker: (id) => {
      writePrefs({ speakerId: id });
      setSpeakerId(id);
    },
    shareScreen,
    stopScreen,
    retry: () => setAttempt((n) => n + 1),
  };
}
