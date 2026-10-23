import { describe, expect, it } from "vitest";
import { actionIsOn, missingRefs, parseAction } from "./actions";
import { ActionError, type RunContext, toRequests } from "./requests";
import { type ObsState, emptyObsState } from "./state";

function obs(): ObsState {
  const s = emptyObsState();
  s.connected = true;
  s.programScene = "Main";
  s.scenes = [
    { name: "Main", uuid: "11111111-1111-1111-1111-111111111111" },
    { name: "Break", uuid: "22222222-2222-2222-2222-222222222222" },
  ];
  s.inputs = {
    Mic: {
      uuid: "33333333-3333-3333-3333-333333333333",
      kind: "coreaudio_input_capture",
      muted: false,
      volumeDb: -6,
      media: null,
    },
    Clip: {
      uuid: "44444444-4444-4444-4444-444444444444",
      kind: "ffmpeg_source",
      muted: false,
      volumeDb: 0,
      media: "OBS_MEDIA_STATE_PLAYING",
    },
  };
  s.items = { Main: [{ id: 7, source: "Clip", enabled: true }] };
  s.filters = { Mic: [{ name: "Gate", enabled: false }] };
  return s;
}

const ctx = (state: ObsState, extra: Partial<RunContext> = {}): RunContext => ({
  state,
  phase: "press",
  screenshotDir: "/Users/me/Movies",
  now: new Date(2026, 9, 23, 9, 5, 7),
  ...extra,
});

const ref = (name: string, uuid: string | null = null) => ({ name, uuid });

describe("toRequests", () => {
  it("maps output toggles to obs-websocket requests", () => {
    const s = obs();
    expect(toRequests({ op: "stream", mode: "toggle" }, ctx(s))).toEqual([
      { requestType: "ToggleStream" },
    ]);
    expect(toRequests({ op: "record", mode: "off" }, ctx(s))).toEqual([
      { requestType: "StopRecord" },
    ]);
    expect(toRequests({ op: "recordPause", mode: "on" }, ctx(s))).toEqual([
      { requestType: "PauseRecord" },
    ]);
    expect(toRequests({ op: "virtualCam", mode: "on" }, ctx(s))).toEqual([
      { requestType: "StartVirtualCam" },
    ]);
  });

  it("switches scenes, finding a renamed scene by UUID", () => {
    const s = obs();
    expect(toRequests({ op: "scene", scene: ref("Break"), target: "program" }, ctx(s))).toEqual([
      { requestType: "SetCurrentProgramScene", requestData: { sceneName: "Break" } },
    ]);
    const renamed = ref("Old name", "22222222-2222-2222-2222-222222222222");
    expect(toRequests({ op: "scene", scene: renamed, target: "preview" }, ctx(s))).toEqual([
      { requestType: "SetCurrentPreviewScene", requestData: { sceneName: "Break" } },
    ]);
    expect(() =>
      toRequests({ op: "scene", scene: ref("Nope"), target: "program" }, ctx(s)),
    ).toThrow(ActionError);
  });

  it("toggles source visibility and filters from the current state", () => {
    const s = obs();
    expect(
      toRequests(
        { op: "sourceVisibility", scene: ref("Main"), source: ref("Clip"), mode: "toggle" },
        ctx(s),
      ),
    ).toEqual([
      {
        requestType: "SetSceneItemEnabled",
        requestData: { sceneName: "Main", sceneItemId: 7, sceneItemEnabled: false },
      },
    ]);
    expect(
      toRequests({ op: "filter", source: ref("Mic"), filter: "Gate", mode: "toggle" }, ctx(s)),
    ).toEqual([
      {
        requestType: "SetSourceFilterEnabled",
        requestData: { sourceName: "Mic", filterName: "Gate", filterEnabled: true },
      },
    ]);
  });

  it("handles push-to-talk on press and release", () => {
    const s = obs();
    const ptt = { op: "mute", input: ref("Mic"), mode: "pushToTalk" } as const;
    expect(toRequests(ptt, ctx(s, { phase: "down" }))[0]?.requestData).toEqual({
      inputName: "Mic",
      inputMuted: false,
    });
    expect(toRequests(ptt, ctx(s, { phase: "up" }))[0]?.requestData).toEqual({
      inputName: "Mic",
      inputMuted: true,
    });
    // Ordinary keys ignore the release.
    expect(toRequests({ op: "stream", mode: "toggle" }, ctx(s, { phase: "up" }))).toEqual([]);
  });

  it("steps, sets and slides the volume within -60…0 dB", () => {
    const s = obs();
    const step = (db: number) =>
      toRequests({ op: "volume", input: ref("Mic"), mode: "step", db }, ctx(s));
    expect(step(3)[0]?.requestData).toEqual({ inputName: "Mic", inputVolumeDb: -3 });
    expect(step(10)[0]?.requestData).toEqual({ inputName: "Mic", inputVolumeDb: 0 });
    expect(
      toRequests(
        { op: "volume", input: ref("Mic"), mode: "slider", db: 0 },
        ctx(s, { value: -20 }),
      )[0]?.requestData,
    ).toEqual({ inputName: "Mic", inputVolumeDb: -20 });
  });

  it("pauses a playing media source on play/pause", () => {
    const s = obs();
    expect(
      toRequests({ op: "media", input: ref("Clip"), media: "playPause" }, ctx(s))[0]?.requestData,
    ).toEqual({
      inputName: "Clip",
      mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE",
    });
  });

  it("saves screenshots of the program scene into the dock's folder", () => {
    const s = obs();
    expect(toRequests({ op: "screenshot", source: null, format: "png" }, ctx(s))).toEqual([
      {
        requestType: "SaveSourceScreenshot",
        requestData: {
          sourceName: "Main",
          imageFormat: "png",
          imageFilePath: "/Users/me/Movies/deck_2026-10-23_09-05-07.png",
        },
      },
    ]);
    expect(() =>
      toRequests({ op: "screenshot", source: null, format: "png" }, ctx(s, { screenshotDir: " " })),
    ).toThrow(ActionError);
  });

  it("passes raw requests through and refuses bad JSON", () => {
    const s = obs();
    expect(toRequests({ op: "raw", requestType: "GetStats", requestData: "" }, ctx(s))).toEqual([
      { requestType: "GetStats", requestData: {} },
    ]);
    expect(() => toRequests({ op: "raw", requestType: "X", requestData: "[1]" }, ctx(s))).toThrow(
      ActionError,
    );
  });
});

describe("actions", () => {
  it("parseAction validates refs and raw request names", () => {
    expect(parseAction({ op: "scene", scene: { name: "" } })).toBeNull();
    expect(parseAction({ op: "raw", requestType: "Bad Name!" })).toBeNull();
    expect(
      parseAction({ op: "mute", input: { name: "Mic", uuid: "not-a-uuid" }, mode: "weird" }),
    ).toEqual({
      op: "mute",
      input: { name: "Mic", uuid: null },
      mode: "toggle",
    });
  });

  it("actionIsOn reflects the live state", () => {
    const s = obs();
    expect(actionIsOn({ op: "scene", scene: ref("Main"), target: "program" }, s)).toBe(true);
    expect(actionIsOn({ op: "scene", scene: ref("Break"), target: "program" }, s)).toBe(false);
    expect(actionIsOn({ op: "mute", input: ref("Mic"), mode: "toggle" }, s)).toBe(false);
    expect(actionIsOn({ op: "hotkey", name: "x" }, s)).toBeNull();
    expect(actionIsOn({ op: "stream", mode: "toggle" }, { ...s, connected: false })).toBeNull();
  });

  it("missingRefs reports missing and renamed sources", () => {
    const s = obs();
    expect(missingRefs({ op: "scene", scene: ref("Gone"), target: "program" }, s)).toEqual([
      "シーン「Gone」が見つかりません",
    ]);
    expect(
      missingRefs(
        {
          op: "scene",
          scene: ref("Old", "11111111-1111-1111-1111-111111111111"),
          target: "program",
        },
        s,
      ),
    ).toEqual(["シーン「Old」は「Main」に名前が変わっています"]);
  });
});
