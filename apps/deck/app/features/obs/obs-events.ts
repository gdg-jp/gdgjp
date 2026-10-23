/**
 * Pure state bookkeeping for the dock: building an ObsState from a full read
 * of OBS, and patching it from obs-websocket events. Structural events (scenes,
 * inputs, items, filters added/removed/renamed) ask for a full re-read instead.
 */

import type { BatchResult } from "./obs-client";
import { type ObsInput, type ObsState, emptyObsState } from "./state";

export const MEDIA_KINDS = new Set(["ffmpeg_source", "vlc_source"]);

const STRUCTURAL = new Set([
  "SceneCreated",
  "SceneRemoved",
  "SceneNameChanged",
  "SceneListChanged",
  "InputCreated",
  "InputRemoved",
  "InputNameChanged",
  "SceneItemCreated",
  "SceneItemRemoved",
  "SceneItemListReindexed",
  "SourceFilterCreated",
  "SourceFilterRemoved",
  "SourceFilterNameChanged",
  "SourceFilterListReindexed",
  "SceneTransitionCreated",
  "SceneTransitionRemoved",
  "SceneTransitionNameChanged",
  "CurrentSceneCollectionChanged",
  "SceneCollectionListChanged",
  "CurrentProfileChanged",
  "ProfileListChanged",
]);

export type EventEffect = {
  state: ObsState;
  /** Something structural changed: re-read everything. */
  refresh: boolean;
  /** Re-read this media input's playback state. */
  media: string | null;
};

type Data = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const bool = (v: unknown): boolean => v === true;

function withInput(state: ObsState, name: string, patch: Partial<ObsInput>): ObsState {
  const input = state.inputs[name];
  if (!input) return state;
  return { ...state, inputs: { ...state.inputs, [name]: { ...input, ...patch } } };
}

export function applyEvent(state: ObsState, type: string, d: Data, now: number): EventEffect {
  const same = (s: ObsState): EventEffect => ({ state: s, refresh: false, media: null });
  if (STRUCTURAL.has(type)) return { state, refresh: true, media: null };
  switch (type) {
    case "StreamStateChanged": {
      const active = bool(d.outputActive);
      if (active === state.streaming) return same(state);
      return same({ ...state, streaming: active, streamSince: active ? now : null });
    }
    case "RecordStateChanged": {
      const outputState = str(d.outputState);
      if (outputState === "OBS_WEBSOCKET_OUTPUT_PAUSED")
        return same({ ...state, recordPaused: true });
      if (outputState === "OBS_WEBSOCKET_OUTPUT_RESUMED")
        return same({ ...state, recordPaused: false });
      const active = bool(d.outputActive);
      if (active === state.recording) return same(state);
      return same({
        ...state,
        recording: active,
        recordPaused: false,
        recordSince: active ? now : null,
      });
    }
    case "VirtualcamStateChanged":
      return same({ ...state, virtualCam: bool(d.outputActive) });
    case "ReplayBufferStateChanged":
      return same({ ...state, replayBuffer: bool(d.outputActive) });
    case "StudioModeStateChanged":
      return same({
        ...state,
        studioMode: bool(d.studioModeEnabled),
        previewScene: bool(d.studioModeEnabled) ? state.previewScene : null,
      });
    case "CurrentProgramSceneChanged":
      return same({ ...state, programScene: str(d.sceneName) || null });
    case "CurrentPreviewSceneChanged":
      return same({ ...state, previewScene: str(d.sceneName) || null });
    case "CurrentSceneTransitionChanged":
      return same({ ...state, transition: str(d.transitionName) || null });
    case "InputMuteStateChanged":
      return same(withInput(state, str(d.inputName), { muted: bool(d.inputMuted) }));
    case "InputVolumeChanged":
      return same(
        withInput(state, str(d.inputName), {
          volumeDb: typeof d.inputVolumeDb === "number" ? d.inputVolumeDb : null,
        }),
      );
    case "SceneItemEnableStateChanged": {
      const scene = str(d.sceneName);
      const items = state.items[scene];
      if (!items) return same(state);
      return same({
        ...state,
        items: {
          ...state.items,
          [scene]: items.map((i) =>
            i.id === d.sceneItemId ? { ...i, enabled: bool(d.sceneItemEnabled) } : i,
          ),
        },
      });
    }
    case "SourceFilterEnableStateChanged": {
      const source = str(d.sourceName);
      const filters = state.filters[source];
      if (!filters) return same(state);
      return same({
        ...state,
        filters: {
          ...state.filters,
          [source]: filters.map((f) =>
            f.name === d.filterName ? { ...f, enabled: bool(d.filterEnabled) } : f,
          ),
        },
      });
    }
    case "MediaInputPlaybackStarted":
      return same(withInput(state, str(d.inputName), { media: "OBS_MEDIA_STATE_PLAYING" }));
    case "MediaInputPlaybackEnded":
      return same(withInput(state, str(d.inputName), { media: "OBS_MEDIA_STATE_ENDED" }));
    case "MediaInputActionTriggered":
      return { state, refresh: false, media: str(d.inputName) || null };
    case "ExitStarted":
      return same({ ...state, connected: false });
    default:
      return same(state);
  }
}

// ─── full read ────────────────────────────────────────────────────────────

/** First batch: everything that does not depend on the scene / input lists. */
export const BASE_REQUESTS = [
  { requestType: "GetVersion" },
  { requestType: "GetStreamStatus" },
  { requestType: "GetRecordStatus" },
  { requestType: "GetVirtualCamStatus" },
  { requestType: "GetReplayBufferStatus" },
  { requestType: "GetStudioModeEnabled" },
  { requestType: "GetSceneList" },
  { requestType: "GetSceneCollectionList" },
  { requestType: "GetProfileList" },
  { requestType: "GetSceneTransitionList" },
  { requestType: "GetHotkeyList" },
  { requestType: "GetInputList" },
] as const;

type Base = Partial<Record<(typeof BASE_REQUESTS)[number]["requestType"], Data>>;

function indexResults(results: BatchResult[]): Record<string, Data | undefined> {
  const out: Record<string, Data | undefined> = {};
  for (const r of results) {
    if (r.requestStatus?.result) out[r.requestType] = r.responseData ?? {};
  }
  return out;
}

export type BaseRead = {
  state: ObsState;
  /** Second batch: per-scene items, per-input audio/media, per-source filters. */
  detailRequests: { requestType: string; requestData: Data }[];
};

const arr = (v: unknown): Data[] => (Array.isArray(v) ? (v as Data[]) : []);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];

function since(active: boolean, durationMs: unknown, now: number): number | null {
  if (!active) return null;
  return now - (typeof durationMs === "number" ? durationMs : 0);
}

export function readBase(results: BatchResult[], now: number): BaseRead {
  const r = indexResults(results) as Base;
  const state = emptyObsState();
  state.connected = true;
  state.obsVersion = str(r.GetVersion?.obsVersion) || null;
  state.streaming = bool(r.GetStreamStatus?.outputActive);
  state.streamSince = since(state.streaming, r.GetStreamStatus?.outputDuration, now);
  state.recording = bool(r.GetRecordStatus?.outputActive);
  state.recordPaused = bool(r.GetRecordStatus?.outputPaused);
  state.recordSince = since(state.recording, r.GetRecordStatus?.outputDuration, now);
  state.virtualCam = bool(r.GetVirtualCamStatus?.outputActive);
  state.replayBuffer = bool(r.GetReplayBufferStatus?.outputActive);
  state.studioMode = bool(r.GetStudioModeEnabled?.studioModeEnabled);

  const sceneList = r.GetSceneList;
  state.programScene = str(sceneList?.currentProgramSceneName) || null;
  state.previewScene = state.studioMode ? str(sceneList?.currentPreviewSceneName) || null : null;
  // OBS lists scenes top-down by descending index.
  state.scenes = arr(sceneList?.scenes)
    .slice()
    .sort((a, b) => Number(b.sceneIndex ?? 0) - Number(a.sceneIndex ?? 0))
    .map((s) => ({ name: str(s.sceneName), uuid: str(s.sceneUuid) }))
    .filter((s) => s.name);

  state.sceneCollection = str(r.GetSceneCollectionList?.currentSceneCollectionName) || null;
  state.sceneCollections = strs(r.GetSceneCollectionList?.sceneCollections);
  state.profile = str(r.GetProfileList?.currentProfileName) || null;
  state.profiles = strs(r.GetProfileList?.profiles);
  state.transition = str(r.GetSceneTransitionList?.currentSceneTransitionName) || null;
  state.transitions = arr(r.GetSceneTransitionList?.transitions)
    .map((t) => str(t.transitionName))
    .filter(Boolean);
  state.hotkeys = strs(r.GetHotkeyList?.hotkeys);

  const detailRequests: BaseRead["detailRequests"] = [];
  for (const s of state.scenes) {
    detailRequests.push({ requestType: "GetSceneItemList", requestData: { sceneName: s.name } });
    detailRequests.push({
      requestType: "GetSourceFilterList",
      requestData: { sourceName: s.name },
    });
  }
  for (const i of arr(r.GetInputList?.inputs)) {
    const name = str(i.inputName);
    if (!name) continue;
    const kind = str(i.unversionedInputKind) || str(i.inputKind);
    state.inputs[name] = {
      uuid: str(i.inputUuid),
      kind,
      muted: null,
      volumeDb: null,
      media: MEDIA_KINDS.has(kind) ? "OBS_MEDIA_STATE_NONE" : null,
    };
    detailRequests.push({ requestType: "GetInputMute", requestData: { inputName: name } });
    detailRequests.push({ requestType: "GetInputVolume", requestData: { inputName: name } });
    detailRequests.push({ requestType: "GetSourceFilterList", requestData: { sourceName: name } });
    if (MEDIA_KINDS.has(kind)) {
      detailRequests.push({ requestType: "GetMediaInputStatus", requestData: { inputName: name } });
    }
  }
  return { state, detailRequests };
}

/** Folds the second batch's answers (same order as `detailRequests`) into the state. */
export function readDetails(
  base: ObsState,
  requests: BaseRead["detailRequests"],
  results: BatchResult[],
): ObsState {
  const state: ObsState = { ...base, inputs: { ...base.inputs }, items: {}, filters: {} };
  requests.forEach((req, index) => {
    const res = results[index];
    const ok = res?.requestStatus?.result === true;
    const d = res?.responseData ?? {};
    const name = str(
      req.requestData.sceneName ?? req.requestData.inputName ?? req.requestData.sourceName,
    );
    switch (req.requestType) {
      case "GetSceneItemList":
        state.items[name] = ok
          ? arr(d.sceneItems).map((i) => ({
              id: Number(i.sceneItemId),
              source: str(i.sourceName),
              enabled: bool(i.sceneItemEnabled),
            }))
          : [];
        break;
      case "GetSourceFilterList":
        if (ok) {
          state.filters[name] = arr(d.filters).map((f) => ({
            name: str(f.filterName),
            enabled: bool(f.filterEnabled),
          }));
        }
        break;
      case "GetInputMute": {
        const input = state.inputs[name];
        if (input && ok) state.inputs[name] = { ...input, muted: bool(d.inputMuted) };
        break;
      }
      case "GetInputVolume": {
        const input = state.inputs[name];
        if (input && ok && typeof d.inputVolumeDb === "number") {
          state.inputs[name] = { ...input, volumeDb: d.inputVolumeDb };
        }
        break;
      }
      case "GetMediaInputStatus": {
        const input = state.inputs[name];
        if (input && ok) state.inputs[name] = { ...input, media: str(d.mediaState) || null };
        break;
      }
    }
  });
  return state;
}
