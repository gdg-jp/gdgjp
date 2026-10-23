/**
 * OBS actions a key can run: the Elgato "OBS Studio" plugin's set, plus
 * hotkeys by name and raw obs-websocket requests.
 *
 * Scenes and sources are referenced by name with the UUID kept alongside
 * (`Ref`): a duplicated deck keeps working on another OBS by name, and a
 * rename on the same OBS is still found by UUID (the editor then warns).
 */

import type { ObsState } from "./state";

export type Ref = { name: string; uuid: string | null };

export type Toggle = "toggle" | "on" | "off";

export const MEDIA_OPS = [
  "playPause",
  "play",
  "pause",
  "stop",
  "restart",
  "next",
  "previous",
] as const;
export type MediaOp = (typeof MEDIA_OPS)[number];

export const MUTE_MODES = ["toggle", "on", "off", "pushToMute", "pushToTalk"] as const;
export type MuteMode = (typeof MUTE_MODES)[number];

export type ObsAction =
  | { op: "stream"; mode: Toggle }
  | { op: "record"; mode: Toggle }
  | { op: "recordPause"; mode: Toggle }
  | { op: "chapterMarker"; name: string }
  | { op: "virtualCam"; mode: Toggle }
  | { op: "replayBuffer"; mode: Toggle }
  | { op: "saveReplay" }
  | { op: "studioMode"; mode: Toggle }
  | { op: "previewToProgram" }
  | { op: "screenshot"; source: Ref | null; format: "png" | "jpg" }
  | { op: "scene"; scene: Ref; target: "program" | "preview" }
  | { op: "sceneCollection"; name: string }
  | { op: "profile"; name: string }
  | { op: "sourceVisibility"; scene: Ref; source: Ref; mode: Toggle }
  | { op: "filter"; source: Ref; filter: string; mode: Toggle }
  | { op: "transition"; name: string; durationMs: number | null }
  | { op: "media"; input: Ref; media: MediaOp }
  | { op: "mute"; input: Ref; mode: MuteMode }
  /** `step` nudges by `db`; `slider` opens a slider on the phone; `set` jumps to `db`. */
  | { op: "volume"; input: Ref; mode: "step" | "set" | "slider"; db: number }
  | { op: "hotkey"; name: string }
  | { op: "raw"; requestType: string; requestData: string };

export type ActionOp = ObsAction["op"];

export const ACTION_LABELS: Record<ActionOp, string> = {
  stream: "配信",
  record: "録画",
  recordPause: "録画の一時停止",
  chapterMarker: "チャプターマーカー",
  virtualCam: "仮想カメラ",
  replayBuffer: "リプレイバッファ",
  saveReplay: "リプレイを保存",
  studioMode: "スタジオモード",
  previewToProgram: "プレビューを本番へ",
  screenshot: "スクリーンショット",
  scene: "シーン",
  sceneCollection: "シーンコレクション",
  profile: "プロファイル",
  sourceVisibility: "ソースの表示",
  filter: "フィルター",
  transition: "トランジション",
  media: "メディア操作",
  mute: "ミュート",
  volume: "音量",
  hotkey: "ホットキー",
  raw: "任意のリクエスト",
};

export const ACTION_OPS = Object.keys(ACTION_LABELS) as ActionOp[];

export const VOLUME_MIN_DB = -60;
export const VOLUME_MAX_DB = 0;

const NAME_MAX = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function name(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.slice(0, NAME_MAX);
  return trimmed.trim() ? trimmed : null;
}

function ref(value: unknown): Ref | null {
  if (!isRecord(value)) return null;
  const n = name(value.name);
  if (!n) return null;
  const uuid =
    typeof value.uuid === "string" && /^[0-9a-f-]{36}$/i.test(value.uuid) ? value.uuid : null;
  return { name: n, uuid };
}

function toggle(value: unknown): Toggle {
  return value === "on" || value === "off" ? value : "toggle";
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return (options as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

function db(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(26, Math.max(-100, n)) * 10) / 10;
}

/** Validates one client-supplied action; null drops it. */
export function parseAction(value: unknown): ObsAction | null {
  if (!isRecord(value)) return null;
  switch (value.op) {
    case "stream":
    case "record":
    case "recordPause":
    case "virtualCam":
    case "replayBuffer":
    case "studioMode":
      return { op: value.op, mode: toggle(value.mode) };
    case "saveReplay":
    case "previewToProgram":
      return { op: value.op };
    case "chapterMarker":
      return {
        op: "chapterMarker",
        name: typeof value.name === "string" ? value.name.slice(0, NAME_MAX) : "",
      };
    case "screenshot":
      return {
        op: "screenshot",
        source: ref(value.source),
        format: value.format === "jpg" ? "jpg" : "png",
      };
    case "scene": {
      const scene = ref(value.scene);
      return scene
        ? { op: "scene", scene, target: value.target === "preview" ? "preview" : "program" }
        : null;
    }
    case "sceneCollection":
    case "profile":
    case "hotkey": {
      const n = name(value.name);
      return n ? { op: value.op, name: n } : null;
    }
    case "sourceVisibility": {
      const scene = ref(value.scene);
      const source = ref(value.source);
      return scene && source
        ? { op: "sourceVisibility", scene, source, mode: toggle(value.mode) }
        : null;
    }
    case "filter": {
      const source = ref(value.source);
      const filter = name(value.filter);
      return source && filter ? { op: "filter", source, filter, mode: toggle(value.mode) } : null;
    }
    case "transition": {
      const n = name(value.name);
      const ms = Number(value.durationMs);
      return n
        ? {
            op: "transition",
            name: n,
            durationMs: Number.isFinite(ms) && ms > 0 ? Math.min(20_000, Math.round(ms)) : null,
          }
        : null;
    }
    case "media": {
      const input = ref(value.input);
      return input
        ? { op: "media", input, media: oneOf(value.media, MEDIA_OPS, "playPause") }
        : null;
    }
    case "mute": {
      const input = ref(value.input);
      return input ? { op: "mute", input, mode: oneOf(value.mode, MUTE_MODES, "toggle") } : null;
    }
    case "volume": {
      const input = ref(value.input);
      if (!input) return null;
      const mode = oneOf(value.mode, ["step", "set", "slider"] as const, "step");
      return { op: "volume", input, mode, db: db(value.db, mode === "step" ? 3 : 0) };
    }
    case "raw": {
      const requestType = typeof value.requestType === "string" ? value.requestType.trim() : "";
      if (!/^[A-Za-z]{1,64}$/.test(requestType)) return null;
      const requestData =
        typeof value.requestData === "string" ? value.requestData.slice(0, 8192) : "";
      return { op: "raw", requestType, requestData };
    }
    default:
      return null;
  }
}

/** Default action for a newly picked op in the editor. */
export function defaultAction(op: ActionOp): ObsAction {
  const empty: Ref = { name: "", uuid: null };
  switch (op) {
    case "stream":
    case "record":
    case "recordPause":
    case "virtualCam":
    case "replayBuffer":
    case "studioMode":
      return { op, mode: "toggle" };
    case "saveReplay":
    case "previewToProgram":
      return { op };
    case "chapterMarker":
      return { op, name: "" };
    case "screenshot":
      return { op, source: null, format: "png" };
    case "scene":
      return { op, scene: empty, target: "program" };
    case "sceneCollection":
    case "profile":
    case "hotkey":
      return { op, name: "" };
    case "sourceVisibility":
      return { op, scene: empty, source: empty, mode: "toggle" };
    case "filter":
      return { op, source: empty, filter: "", mode: "toggle" };
    case "transition":
      return { op, name: "", durationMs: null };
    case "media":
      return { op, input: empty, media: "playPause" };
    case "mute":
      return { op, input: empty, mode: "toggle" };
    case "volume":
      return { op, input: empty, mode: "step", db: 3 };
    case "raw":
      return { op, requestType: "", requestData: "" };
  }
}

/** Starting/stopping the stream or the recording: the editor defaults these to hold-to-confirm. */
export function isDangerous(action: ObsAction): boolean {
  return (action.op === "stream" || action.op === "record") && action.mode !== "on";
}

/** Push-to-talk / push-to-mute keys act on press and on release. */
export function isMomentary(action: ObsAction): boolean {
  return action.op === "mute" && (action.mode === "pushToMute" || action.mode === "pushToTalk");
}

// ─── resolving refs against the live OBS ──────────────────────────────────

export type Resolved = { name: string; renamed: boolean } | null;

export function resolveScene(r: Ref, state: ObsState): Resolved {
  if (state.scenes.some((s) => s.name === r.name)) return { name: r.name, renamed: false };
  const byUuid = r.uuid ? state.scenes.find((s) => s.uuid === r.uuid) : undefined;
  return byUuid ? { name: byUuid.name, renamed: true } : null;
}

export function resolveInput(r: Ref, state: ObsState): Resolved {
  if (state.inputs[r.name]) return { name: r.name, renamed: false };
  if (!r.uuid) return null;
  const hit = Object.entries(state.inputs).find(([, input]) => input.uuid === r.uuid);
  return hit ? { name: hit[0], renamed: true } : null;
}

/** A scene or an input (filters and screenshots take either). */
export function resolveSource(r: Ref, state: ObsState): Resolved {
  return resolveScene(r, state) ?? resolveInput(r, state);
}

/** Refs an action uses that the current OBS does not have (by name or UUID), for editor warnings. */
export function missingRefs(action: ObsAction, state: ObsState): string[] {
  const out: string[] = [];
  const check = (r: Ref | null, resolve: (r: Ref, s: ObsState) => Resolved, label: string) => {
    if (!r?.name) return;
    const hit = resolve(r, state);
    if (!hit) out.push(`${label}「${r.name}」が見つかりません`);
    else if (hit.renamed) out.push(`${label}「${r.name}」は「${hit.name}」に名前が変わっています`);
  };
  switch (action.op) {
    case "scene":
      check(action.scene, resolveScene, "シーン");
      break;
    case "sourceVisibility":
      check(action.scene, resolveScene, "シーン");
      check(action.source, resolveSource, "ソース");
      break;
    case "filter":
      check(action.source, resolveSource, "ソース");
      break;
    case "screenshot":
      check(action.source, resolveSource, "ソース");
      break;
    case "media":
    case "mute":
    case "volume":
      check(action.input, resolveInput, "音声/メディア");
      break;
  }
  return out;
}

// ─── key state ────────────────────────────────────────────────────────────

/**
 * Whether the action's key shows as "on": the live scene, a running output,
 * a muted input, a visible source… null for actions without a state.
 */
export function actionIsOn(action: ObsAction, state: ObsState): boolean | null {
  if (!state.connected) return null;
  switch (action.op) {
    case "stream":
      return state.streaming;
    case "record":
      return state.recording;
    case "recordPause":
      return state.recordPaused;
    case "virtualCam":
      return state.virtualCam;
    case "replayBuffer":
      return state.replayBuffer;
    case "studioMode":
      return state.studioMode;
    case "scene": {
      const scene = resolveScene(action.scene, state);
      if (!scene) return false;
      return action.target === "preview"
        ? state.previewScene === scene.name
        : state.programScene === scene.name;
    }
    case "sceneCollection":
      return state.sceneCollection === action.name;
    case "profile":
      return state.profile === action.name;
    case "transition":
      return state.transition === action.name;
    case "sourceVisibility": {
      const scene = resolveScene(action.scene, state);
      const source = resolveSource(action.source, state);
      if (!scene || !source) return false;
      return state.items[scene.name]?.find((i) => i.source === source.name)?.enabled ?? false;
    }
    case "filter": {
      const source = resolveSource(action.source, state);
      if (!source) return false;
      return state.filters[source.name]?.find((f) => f.name === action.filter)?.enabled ?? false;
    }
    case "mute": {
      const input = resolveInput(action.input, state);
      return input ? (state.inputs[input.name]?.muted ?? false) : false;
    }
    case "media": {
      const input = resolveInput(action.input, state);
      return input ? state.inputs[input.name]?.media === "OBS_MEDIA_STATE_PLAYING" : false;
    }
    default:
      return null;
  }
}

/** Current dB of a volume key's input (for the label and slider). */
export function actionVolumeDb(action: ObsAction, state: ObsState): number | null {
  if (action.op !== "volume" && action.op !== "mute") return null;
  const input = resolveInput(action.input, state);
  return input ? (state.inputs[input.name]?.volumeDb ?? null) : null;
}
