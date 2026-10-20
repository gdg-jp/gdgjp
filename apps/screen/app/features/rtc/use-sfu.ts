import { useEffect, useState, useSyncExternalStore } from "react";
import type { Layer } from "./sfu-client";
import { type PublishSlot, SfuManager, type SfuSnapshot } from "./sfu-manager";

const SERVER_SNAPSHOT: SfuSnapshot = {
  sessionId: null,
  status: "connecting",
  remote: new Map(),
  layered: [],
};

/**
 * Full, half and quarter resolution. The OBS output pulls f (falling back to
 * h, q when the speaker's uplink drops it); the control room's small tiles
 * pull a low layer, so its monitoring costs a fraction of the egress.
 */
function layers(full: number, half: number, quarter: number): Layer[] {
  return [
    { rid: "f", scaleResolutionDownBy: 1, maxBitrate: full },
    { rid: "h", scaleResolutionDownBy: 2, maxBitrate: half },
    { rid: "q", scaleResolutionDownBy: 4, maxBitrate: quarter },
  ];
}

/** Video slots tuned per the agreed preset: screen keeps resolution, camera keeps frame rate. */
export const SPEAKER_PUBLISH: PublishSlot[] = [
  { key: "mic", kind: "audio" },
  {
    key: "camera",
    kind: "video",
    maxBitrate: 1_500_000,
    layers: layers(1_500_000, 500_000, 150_000),
    degradation: "maintain-framerate",
  },
  {
    key: "screen",
    kind: "video",
    maxBitrate: 2_500_000,
    layers: layers(2_500_000, 800_000, 250_000),
    degradation: "maintain-resolution",
  },
  { key: "screenAudio", kind: "audio" },
];

/**
 * Operators' video is only watched full size by speakers, so it stays a
 * single stream: no layer anyone would pull, no extra encoding cost.
 */
export const OPERATOR_PUBLISH: PublishSlot[] = SPEAKER_PUBLISH.map(
  ({ layers: _l, ...slot }) => slot,
);

/**
 * One SFU manager per page, alive while `enabled`. Returns the manager (to
 * attach local tracks / declare wanted remotes) and its live snapshot.
 */
export function useSfu(
  stageId: string,
  auth: string | null,
  publish: PublishSlot[],
  enabled: boolean,
): { manager: SfuManager | null; snapshot: SfuSnapshot } {
  const [manager, setManager] = useState<SfuManager | null>(null);

  // `publish` is a module constant per page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!enabled) return;
    const m = new SfuManager(stageId, auth, publish);
    setManager(m);
    m.start();
    return () => {
      m.stop();
      setManager(null);
    };
  }, [stageId, auth, enabled]);

  const snapshot = useSyncExternalStore(
    manager?.subscribe ?? noopSubscribe,
    manager?.getSnapshot ?? serverSnapshot,
    serverSnapshot,
  );
  return { manager, snapshot };
}

const noopSubscribe = () => () => {};
const serverSnapshot = () => SERVER_SNAPSHOT;
