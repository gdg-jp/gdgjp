import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DeviceLists,
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
  camOn?: boolean;
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
  camOn: boolean;
  micId: string;
  camId: string;
  speakerId: string;
  devices: DeviceLists;
  problem: { mic: PermissionProblem | null; camera: PermissionProblem | null };
  /** Set when the browser's own "stop sharing" ended the capture. */
  screenEndedByBrowser: boolean;
  toggleMic: () => void;
  toggleCam: () => void;
  setMicEnabled: (on: boolean) => void;
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
 */
export function useLocalMedia(enabled = true): LocalMedia {
  const [mic, setMic] = useState<MediaStreamTrack | null>(null);
  const [camera, setCamera] = useState<MediaStreamTrack | null>(null);
  const [screen, setScreen] = useState<ScreenCapture | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [micId, setMicId] = useState("");
  const [camId, setCamId] = useState("");
  const [speakerId, setSpeakerId] = useState("");
  const [devices, setDevices] = useState<DeviceLists>(EMPTY_DEVICES);
  const [problem, setProblem] = useState<LocalMedia["problem"]>({ mic: null, camera: null });
  const [screenEndedByBrowser, setScreenEndedByBrowser] = useState(false);
  const [attempt, setAttempt] = useState(0);
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
    if (typeof prefs.camOn === "boolean") setCamOn(prefs.camOn);
  }, []);

  const refreshDevices = useCallback(() => {
    void listDevices().then(setDevices);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refreshDevices();
    navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", refreshDevices);
  }, [enabled, refreshDevices]);

  // Mic: open for the chosen device; reopen on change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt forces a retry
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let opened: MediaStreamTrack | null = null;
    openMic(micId || undefined)
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
  }, [enabled, micId, attempt, refreshDevices]);

  useEffect(() => {
    if (mic) mic.enabled = micOn;
  }, [mic, micOn]);

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
    camOn,
    micId,
    camId,
    speakerId,
    devices,
    problem,
    screenEndedByBrowser,
    toggleMic: () =>
      setMicOn((on) => {
        writePrefs({ micOn: !on });
        return !on;
      }),
    toggleCam: () =>
      setCamOn((on) => {
        writePrefs({ camOn: !on });
        return !on;
      }),
    setMicEnabled: (on: boolean) => setMicOn(on),
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
