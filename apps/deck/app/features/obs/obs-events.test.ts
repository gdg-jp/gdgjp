import { describe, expect, it } from "vitest";
import { obsAuth } from "./obs-client";
import { applyEvent, readBase, readDetails } from "./obs-events";
import { emptyObsState } from "./state";

const ok = (requestType: string, responseData: Record<string, unknown>) => ({
  requestType,
  requestStatus: { result: true, code: 100 },
  responseData,
});
const fail = (requestType: string) => ({
  requestType,
  requestStatus: { result: false, code: 604 },
});

describe("readBase / readDetails", () => {
  it("builds the state from two batches", () => {
    const base = readBase(
      [
        ok("GetVersion", { obsVersion: "32.2.2" }),
        ok("GetStreamStatus", { outputActive: true, outputDuration: 5000 }),
        ok("GetRecordStatus", { outputActive: false, outputPaused: false }),
        fail("GetReplayBufferStatus"),
        ok("GetStudioModeEnabled", { studioModeEnabled: false }),
        ok("GetSceneList", {
          currentProgramSceneName: "B",
          scenes: [
            { sceneName: "A", sceneUuid: "a", sceneIndex: 0 },
            { sceneName: "B", sceneUuid: "b", sceneIndex: 1 },
          ],
        }),
        ok("GetInputList", {
          inputs: [
            { inputName: "Mic", inputUuid: "m", inputKind: "coreaudio_input_capture" },
            { inputName: "Cam", inputUuid: "c", inputKind: "av_capture_input" },
          ],
        }),
      ],
      10_000,
    );
    expect(base.state.streaming).toBe(true);
    expect(base.state.streamSince).toBe(5000);
    expect(base.state.replayBuffer).toBe(false);
    // OBS UI order: highest index first.
    expect(base.state.scenes.map((s) => s.name)).toEqual(["B", "A"]);

    const results = base.detailRequests.map((req) => {
      const target =
        req.requestData.sceneName ?? req.requestData.inputName ?? req.requestData.sourceName;
      if (req.requestType === "GetSceneItemList") {
        return ok(req.requestType, {
          sceneItems: [{ sceneItemId: 1, sourceName: "Cam", sceneItemEnabled: true }],
        });
      }
      if (req.requestType === "GetInputMute") {
        return target === "Mic" ? ok(req.requestType, { inputMuted: true }) : fail(req.requestType);
      }
      if (req.requestType === "GetInputVolume") {
        return target === "Mic"
          ? ok(req.requestType, { inputVolumeDb: -3 })
          : fail(req.requestType);
      }
      return ok(req.requestType, { filters: [] });
    });
    const state = readDetails(base.state, base.detailRequests, results);
    expect(state.inputs.Mic).toMatchObject({ muted: true, volumeDb: -3 });
    expect(state.inputs.Cam).toMatchObject({ muted: null, volumeDb: null });
    expect(state.items.A).toEqual([{ id: 1, source: "Cam", enabled: true }]);
  });
});

describe("applyEvent", () => {
  it("patches outputs, scenes and inputs; asks for a refresh on structure changes", () => {
    let s = emptyObsState();
    s.connected = true;
    s.inputs.Mic = { uuid: "m", kind: "k", muted: false, volumeDb: 0, media: null };
    s = applyEvent(s, "StreamStateChanged", { outputActive: true }, 42).state;
    expect(s.streaming).toBe(true);
    expect(s.streamSince).toBe(42);
    s = applyEvent(
      s,
      "RecordStateChanged",
      { outputActive: true, outputState: "OBS_WEBSOCKET_OUTPUT_STARTED" },
      50,
    ).state;
    s = applyEvent(
      s,
      "RecordStateChanged",
      { outputActive: true, outputState: "OBS_WEBSOCKET_OUTPUT_PAUSED" },
      60,
    ).state;
    expect(s.recording && s.recordPaused).toBe(true);
    s = applyEvent(s, "CurrentProgramSceneChanged", { sceneName: "B" }, 0).state;
    expect(s.programScene).toBe("B");
    s = applyEvent(s, "InputMuteStateChanged", { inputName: "Mic", inputMuted: true }, 0).state;
    expect(s.inputs.Mic?.muted).toBe(true);
    expect(applyEvent(s, "SceneCreated", { sceneName: "C" }, 0).refresh).toBe(true);
    expect(applyEvent(s, "MediaInputActionTriggered", { inputName: "Clip" }, 0).media).toBe("Clip");
  });
});

describe("obsAuth", () => {
  it("matches the obs-websocket reference algorithm", async () => {
    // base64(sha256(base64(sha256("supersecretpassword" + salt)) + challenge))
    const { createHash } = await import("node:crypto");
    const b64 = (s: string) => createHash("sha256").update(s).digest("base64");
    const salt = "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=";
    const challenge = "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=";
    expect(await obsAuth("supersecretpassword", salt, challenge)).toBe(
      b64(`${b64(`supersecretpassword${salt}`)}${challenge}`),
    );
  });
});
