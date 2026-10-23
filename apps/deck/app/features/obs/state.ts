/**
 * OBS as the dock sees it, relayed by the room to every controller and editor.
 *
 * The same snapshot drives key states (live scene, muted, recording…) and the
 * editor's pickers (scene / source / filter lists). It is a few KB for a
 * typical scene collection, so the dock always sends it whole.
 */

export type ObsInput = {
  uuid: string;
  kind: string;
  /** null when the input has no audio. */
  muted: boolean | null;
  volumeDb: number | null;
  /** obs-websocket media state (`OBS_MEDIA_STATE_PLAYING`…) for media inputs, else null. */
  media: string | null;
};

export type ObsSceneItem = { id: number; source: string; enabled: boolean };

export type ObsFilter = { name: string; enabled: boolean };

export type ObsState = {
  /** The dock is connected to (and identified with) obs-websocket. */
  connected: boolean;
  obsVersion: string | null;
  streaming: boolean;
  /** Wall-clock ms the current stream started (dock clock), for the timer. */
  streamSince: number | null;
  recording: boolean;
  recordPaused: boolean;
  recordSince: number | null;
  virtualCam: boolean;
  replayBuffer: boolean;
  studioMode: boolean;
  programScene: string | null;
  previewScene: string | null;
  sceneCollection: string | null;
  profile: string | null;
  transition: string | null;
  scenes: { name: string; uuid: string }[];
  inputs: Record<string, ObsInput>;
  /** Top-level scene items per scene name. */
  items: Record<string, ObsSceneItem[]>;
  /** Filters per source (scene or input) name. */
  filters: Record<string, ObsFilter[]>;
  transitions: string[];
  sceneCollections: string[];
  profiles: string[];
  hotkeys: string[];
};

export function emptyObsState(): ObsState {
  return {
    connected: false,
    obsVersion: null,
    streaming: false,
    streamSince: null,
    recording: false,
    recordPaused: false,
    recordSince: null,
    virtualCam: false,
    replayBuffer: false,
    studioMode: false,
    programScene: null,
    previewScene: null,
    sceneCollection: null,
    profile: null,
    transition: null,
    scenes: [],
    inputs: {},
    items: {},
    filters: {},
    transitions: [],
    sceneCollections: [],
    profiles: [],
    hotkeys: [],
  };
}

/** Every source name that can carry filters (scenes and inputs). */
export function sourceNames(state: ObsState): string[] {
  return [...state.scenes.map((s) => s.name), ...Object.keys(state.inputs)];
}

export function audioInputs(state: ObsState): string[] {
  return Object.entries(state.inputs)
    .filter(([, input]) => input.muted !== null)
    .map(([name]) => name);
}

export function mediaInputs(state: ObsState): string[] {
  return Object.entries(state.inputs)
    .filter(([, input]) => input.media !== null)
    .map(([name]) => name);
}
