import type { RemoteRef } from "~/features/rtc/sfu-client";
import type { Peer, Slot } from "./protocol";

/**
 * What the control room pulls: every online speaker's audio (monitoring), but
 * video only for speakers in a slot. SlotCard is the only place video renders,
 * and every pulled track is billed SFU egress.
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
    const add = (name: string | null, on: boolean) => {
      if (name && on) refs.push({ sessionId: sid, trackName: name });
    };
    const shown = assigned.has(p.id);
    add(p.tracks.mic, true);
    add(p.tracks.camera, p.cam && shown);
    add(p.tracks.screen, p.screen && shown);
    add(p.tracks.screenAudio, p.screenAudio);
  }
  return refs;
}
