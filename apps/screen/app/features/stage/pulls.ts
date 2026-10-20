import type { LayerPick, RemoteRef, Rid } from "~/features/rtc/sfu-client";
import type { OutputKind, Peer, Slot } from "./protocol";

/**
 * OBS gets the full layer, but steps down to h, then q, when the speaker's
 * uplink stops sending f: a softer picture beats a frozen one on air.
 */
const OUTPUT_PICK: LayerPick = {
  preferredRid: "f",
  priorityOrdering: "asciibetical",
  ridNotAvailable: "asciibetical",
};

/** Control-room tiles: the camera tile is a third of a slot, the screen two thirds. */
const MONITOR_RID: Record<"camera" | "screen", Rid> = { camera: "q", screen: "h" };

function monitorPick(kind: "camera" | "screen"): LayerPick {
  return {
    preferredRid: MONITOR_RID[kind],
    priorityOrdering: "none",
    ridNotAvailable: "asciibetical",
  };
}

function videoRef(peer: Peer, kind: "camera" | "screen", pick: LayerPick): RemoteRef | null {
  const name = peer.tracks[kind];
  if (!peer.sfuSessionId || !name) return null;
  const ref: RemoteRef = { sessionId: peer.sfuSessionId, trackName: name };
  // Rooms saved before simulcast existed lack the flags.
  if (peer.simulcast?.[kind]) ref.simulcast = pick;
  return ref;
}

/**
 * What the control room pulls: every online speaker's audio (monitoring), but
 * video only for speakers in a slot, at a low simulcast layer. SlotCard is the
 * only place video renders, and every pulled track is billed SFU egress.
 */
export function controlRoomRefs(
  speakers: Peer[],
  slots: Partial<Record<Slot, string | null>>,
): RemoteRef[] {
  const assigned = new Set(Object.values(slots));
  const refs: RemoteRef[] = [];
  for (const p of speakers) {
    const sid = p.sfuSessionId;
    if (!p.online || !sid) continue;
    const add = (ref: RemoteRef | null, on: boolean) => {
      if (ref && on) refs.push(ref);
    };
    const audio = (name: string | null) => (name ? { sessionId: sid, trackName: name } : null);
    const shown = assigned.has(p.id);
    add(audio(p.tracks.mic), true);
    add(videoRef(p, "camera", monitorPick("camera")), p.cam && shown);
    add(videoRef(p, "screen", monitorPick("screen")), p.screen && shown);
    add(audio(p.tracks.screenAudio), p.screenAudio);
  }
  return refs;
}

/** What one OBS Browser Source pulls; the main track comes first. */
export function outputRefs(peer: Peer | null, kind: OutputKind): RemoteRef[] {
  const sid = peer?.sfuSessionId;
  if (!peer?.online || !sid) return [];
  const refs: RemoteRef[] = [];
  const add = (ref: RemoteRef | null) => {
    if (ref) refs.push(ref);
  };
  const audio = (name: string | null) => (name ? { sessionId: sid, trackName: name } : null);
  if (kind === "camera" && peer.cam) add(videoRef(peer, "camera", OUTPUT_PICK));
  if (kind === "screen" && peer.screen) {
    add(videoRef(peer, "screen", OUTPUT_PICK));
    if (peer.screenAudio) add(audio(peer.tracks.screenAudio));
  }
  if (kind === "mic") add(audio(peer.tracks.mic));
  return refs;
}
