import { type DeckLayout, type Key, type Step, findKey } from "~/features/deck/model";
import { VOLUME_MAX_DB, VOLUME_MIN_DB, isMomentary } from "~/features/obs/actions";
import type { Phase } from "~/features/obs/requests";
import type { ControllerMessage } from "./protocol";

export type Run = {
  key: Key;
  steps: Step[];
  phase: Phase;
  value?: number;
  /** Multi-action switch positions after this press. */
  switches: Record<string, boolean>;
};

export type PressResult = { ok: true; run: Run } | { ok: false; error: string };

/**
 * Resolves a controller's press against the saved layout: which steps the dock
 * runs. Navigation keys (folders, pages) never reach here; the phone handles
 * them. Release events only matter for push-to-talk / push-to-mute keys.
 */
export function resolvePress(
  layout: DeckLayout,
  switches: Record<string, boolean>,
  msg: Extract<ControllerMessage, { type: "press" | "volume" }>,
): PressResult {
  const key = findKey(layout, msg.keyId);
  if (!key) return { ok: false, error: "このキーはもうありません" };
  const b = key.behavior;

  if (msg.type === "volume") {
    if (b.type !== "action" || b.action.op !== "volume" || b.action.mode !== "slider") {
      return { ok: false, error: "音量スライダーのキーではありません" };
    }
    const db = Number(msg.db);
    if (!Number.isFinite(db)) return { ok: false, error: "音量が不正です" };
    const value = Math.min(VOLUME_MAX_DB, Math.max(VOLUME_MIN_DB, db));
    return {
      ok: true,
      run: { key, steps: [{ type: "obs", action: b.action }], phase: "press", value, switches },
    };
  }

  const phase: Phase = msg.phase === "down" || msg.phase === "up" ? msg.phase : "press";
  switch (b.type) {
    case "action": {
      const momentary = isMomentary(b.action);
      if (momentary && phase === "press") {
        return { ok: false, error: "押している間だけ動くキーです" };
      }
      if (!momentary && phase !== "press") return { ok: false, error: "ignored" };
      return {
        ok: true,
        run: { key, steps: [{ type: "obs", action: b.action }], phase, switches },
      };
    }
    case "multi":
      if (phase !== "press") return { ok: false, error: "ignored" };
      return { ok: true, run: { key, steps: b.steps, phase, switches } };
    case "multiSwitch": {
      if (phase !== "press") return { ok: false, error: "ignored" };
      const second = switches[key.id] === true;
      return {
        ok: true,
        run: {
          key,
          steps: second ? b.b : b.a,
          phase,
          switches: { ...switches, [key.id]: !second },
        },
      };
    }
    default:
      return { ok: false, error: "このキーは OBS を操作しません" };
  }
}
