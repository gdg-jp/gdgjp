export type ObsInput = {
  uuid: string;
  kind: string;
  muted: boolean | null;
  volumeDb: number | null;
  media: string | null;
};

export type ObsSceneItem = { id: number; source: string; enabled: boolean };

export type ObsFilter = { name: string; enabled: boolean };

export type ObsState = {
  connected: boolean;
  obsVersion: string | null;
  streaming: boolean;
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
  items: Record<string, ObsSceneItem[]>;
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
