import { actionIsOn, actionVolumeDb } from "~/features/obs/actions";
import type { ObsState } from "~/features/obs/state";
import type { Key } from "./model";

/** Whether a key shows as "on" right now; null when it has no state. */
export function keyIsOn(
  key: Key,
  obs: ObsState,
  switches: Record<string, boolean>,
): boolean | null {
  const b = key.behavior;
  if (b.type === "action") return actionIsOn(b.action, obs);
  if (b.type === "multiSwitch") return switches[key.id] === true;
  return null;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDb(db: number): string {
  return db <= -100 ? "-∞ dB" : `${db.toFixed(1)} dB`;
}

/** Small live text under the title: output timers and volume levels. */
export function keyBadge(key: Key, obs: ObsState, now: number): string | null {
  const b = key.behavior;
  if (b.type !== "action" || !obs.connected) return null;
  const a = b.action;
  if (a.op === "stream" && obs.streaming && obs.streamSince !== null) {
    return formatElapsed(now - obs.streamSince);
  }
  if (a.op === "record" && obs.recording) {
    if (obs.recordPaused) return "一時停止中";
    return obs.recordSince !== null ? formatElapsed(now - obs.recordSince) : null;
  }
  if (a.op === "volume") {
    const db = actionVolumeDb(a, obs);
    return db === null ? null : formatDb(db);
  }
  return null;
}
