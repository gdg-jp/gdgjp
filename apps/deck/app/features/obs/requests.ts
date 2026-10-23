/**
 * Turns a key's action into obs-websocket v5 requests (run by the dock).
 *
 * Toggles OBS has no request for (studio mode, source visibility, filters,
 * play/pause) read the current value from the dock's live state.
 */

import {
  type MediaOp,
  type ObsAction,
  type Toggle,
  VOLUME_MAX_DB,
  VOLUME_MIN_DB,
  actionIsOn,
  resolveInput,
  resolveScene,
  resolveSource,
} from "./actions";
import type { ObsState } from "./state";

export type ObsRequest = { requestType: string; requestData?: Record<string, unknown> };

/** How a key was operated: a tap, or press/release of a push-to-talk key. */
export type Phase = "press" | "down" | "up";

export type RunContext = {
  state: ObsState;
  phase: Phase;
  /** Slider value for `volume` keys in slider mode. */
  value?: number;
  /** Folder the dock saves screenshots into (dock setting). */
  screenshotDir: string;
  now: Date;
};

export class ActionError extends Error {}

function pick(mode: Toggle, toggle: string, on: string, off: string): ObsRequest {
  return { requestType: mode === "toggle" ? toggle : mode === "on" ? on : off };
}

/** on/off for a toggle given the current value. */
function target(mode: Toggle, current: boolean): boolean {
  return mode === "toggle" ? !current : mode === "on";
}

const MEDIA_ACTIONS: Record<Exclude<MediaOp, "playPause">, string> = {
  play: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY",
  pause: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE",
  stop: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP",
  restart: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
  next: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT",
  previous: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS",
};

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function joinPath(dir: string, file: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith("/") || dir.endsWith("\\") ? `${dir}${file}` : `${dir}${sep}${file}`;
}

function clampVolume(db: number): number {
  return Math.round(Math.min(VOLUME_MAX_DB, Math.max(VOLUME_MIN_DB, db)) * 10) / 10;
}

/** Requests for one action; throws ActionError when it cannot run (missing scene…). */
export function toRequests(action: ObsAction, ctx: RunContext): ObsRequest[] {
  const { state, phase } = ctx;
  // Only push-to-talk / push-to-mute react to release.
  if (phase === "up" && !(action.op === "mute" && action.mode.startsWith("push"))) return [];

  switch (action.op) {
    case "stream":
      return [pick(action.mode, "ToggleStream", "StartStream", "StopStream")];
    case "record":
      return [pick(action.mode, "ToggleRecord", "StartRecord", "StopRecord")];
    case "recordPause":
      return [pick(action.mode, "ToggleRecordPause", "PauseRecord", "ResumeRecord")];
    case "virtualCam":
      return [pick(action.mode, "ToggleVirtualCam", "StartVirtualCam", "StopVirtualCam")];
    case "replayBuffer":
      return [pick(action.mode, "ToggleReplayBuffer", "StartReplayBuffer", "StopReplayBuffer")];
    case "saveReplay":
      return [{ requestType: "SaveReplayBuffer" }];
    case "chapterMarker":
      return [
        {
          requestType: "CreateRecordChapter",
          requestData: action.name ? { chapterName: action.name } : {},
        },
      ];
    case "studioMode":
      return [
        {
          requestType: "SetStudioModeEnabled",
          requestData: { studioModeEnabled: target(action.mode, state.studioMode) },
        },
      ];
    case "previewToProgram":
      return [{ requestType: "TriggerStudioModeTransition" }];
    case "screenshot": {
      const source = action.source ? resolveSource(action.source, state)?.name : state.programScene;
      if (!source) throw new ActionError("スクリーンショットするソースがありません");
      if (!ctx.screenshotDir.trim())
        throw new ActionError("ドックで保存先フォルダを設定してください");
      const file = `deck_${stamp(ctx.now)}.${action.format}`;
      return [
        {
          requestType: "SaveSourceScreenshot",
          requestData: {
            sourceName: source,
            imageFormat: action.format,
            imageFilePath: joinPath(ctx.screenshotDir.trim(), file),
          },
        },
      ];
    }
    case "scene": {
      const scene = resolveScene(action.scene, state);
      if (!scene) throw new ActionError(`シーン「${action.scene.name}」がありません`);
      return action.target === "preview"
        ? [{ requestType: "SetCurrentPreviewScene", requestData: { sceneName: scene.name } }]
        : [{ requestType: "SetCurrentProgramScene", requestData: { sceneName: scene.name } }];
    }
    case "sceneCollection":
      return [
        {
          requestType: "SetCurrentSceneCollection",
          requestData: { sceneCollectionName: action.name },
        },
      ];
    case "profile":
      return [{ requestType: "SetCurrentProfile", requestData: { profileName: action.name } }];
    case "sourceVisibility": {
      const scene = resolveScene(action.scene, state);
      const source = resolveSource(action.source, state);
      const item =
        scene && source
          ? state.items[scene.name]?.find((i) => i.source === source.name)
          : undefined;
      if (!scene || !item) {
        throw new ActionError(`「${action.scene.name}」に「${action.source.name}」がありません`);
      }
      return [
        {
          requestType: "SetSceneItemEnabled",
          requestData: {
            sceneName: scene.name,
            sceneItemId: item.id,
            sceneItemEnabled: target(action.mode, item.enabled),
          },
        },
      ];
    }
    case "filter": {
      const source = resolveSource(action.source, state);
      const filter = source
        ? state.filters[source.name]?.find((f) => f.name === action.filter)
        : undefined;
      if (!source || !filter) {
        throw new ActionError(
          `「${action.source.name}」にフィルター「${action.filter}」がありません`,
        );
      }
      return [
        {
          requestType: "SetSourceFilterEnabled",
          requestData: {
            sourceName: source.name,
            filterName: filter.name,
            filterEnabled: target(action.mode, filter.enabled),
          },
        },
      ];
    }
    case "transition": {
      const out: ObsRequest[] = [
        { requestType: "SetCurrentSceneTransition", requestData: { transitionName: action.name } },
      ];
      if (action.durationMs) {
        out.push({
          requestType: "SetCurrentSceneTransitionDuration",
          requestData: { transitionDuration: Math.max(50, action.durationMs) },
        });
      }
      return out;
    }
    case "media": {
      const input = resolveInput(action.input, state);
      if (!input) throw new ActionError(`メディア「${action.input.name}」がありません`);
      const op =
        action.media === "playPause"
          ? actionIsOn(action, state)
            ? "pause"
            : "play"
          : action.media;
      return [
        {
          requestType: "TriggerMediaInputAction",
          requestData: { inputName: input.name, mediaAction: MEDIA_ACTIONS[op] },
        },
      ];
    }
    case "mute": {
      const input = resolveInput(action.input, state);
      if (!input) throw new ActionError(`音声「${action.input.name}」がありません`);
      let muted: boolean;
      if (action.mode === "pushToTalk") muted = phase === "up";
      else if (action.mode === "pushToMute") muted = phase !== "up";
      else muted = target(action.mode, state.inputs[input.name]?.muted ?? false);
      return [
        { requestType: "SetInputMute", requestData: { inputName: input.name, inputMuted: muted } },
      ];
    }
    case "volume": {
      const input = resolveInput(action.input, state);
      if (!input) throw new ActionError(`音声「${action.input.name}」がありません`);
      let db: number;
      if (action.mode === "slider") {
        if (ctx.value === undefined) return [];
        db = ctx.value;
      } else if (action.mode === "set") {
        db = action.db;
      } else {
        const current = state.inputs[input.name]?.volumeDb ?? VOLUME_MIN_DB;
        db = Math.max(current, VOLUME_MIN_DB) + action.db;
      }
      return [
        {
          requestType: "SetInputVolume",
          requestData: { inputName: input.name, inputVolumeDb: clampVolume(db) },
        },
      ];
    }
    case "hotkey":
      return [{ requestType: "TriggerHotkeyByName", requestData: { hotkeyName: action.name } }];
    case "raw": {
      let data: unknown = {};
      if (action.requestData.trim()) {
        try {
          data = JSON.parse(action.requestData);
        } catch {
          throw new ActionError("requestData が JSON ではありません");
        }
      }
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new ActionError("requestData は JSON オブジェクトにしてください");
      }
      return [{ requestType: action.requestType, requestData: data as Record<string, unknown> }];
    }
  }
}
