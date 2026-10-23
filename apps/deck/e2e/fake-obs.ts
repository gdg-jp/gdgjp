/**
 * A small obs-websocket v5 server for e2e tests: Hello/Identify with the
 * SHA-256 challenge, the requests the dock reads and runs, request batches,
 * and the events those requests would make OBS emit.
 *
 *   node --experimental-strip-types e2e/fake-obs.ts [port] [password]
 */

import { createHash, randomBytes } from "node:crypto";
import { type WebSocket, WebSocketServer } from "ws";

type Data = Record<string, unknown>;

export type FakeObsState = {
  program: string;
  preview: string | null;
  studio: boolean;
  streaming: boolean;
  recording: boolean;
  recordPaused: boolean;
  virtualCam: boolean;
  scenes: string[];
  items: Record<string, { id: number; source: string; enabled: boolean }[]>;
  inputs: Record<string, { kind: string; muted: boolean | null; volumeDb: number }>;
  filters: Record<string, { name: string; enabled: boolean }[]>;
};

function initialState(): FakeObsState {
  return {
    program: "Main",
    preview: null,
    studio: false,
    streaming: false,
    recording: false,
    recordPaused: false,
    virtualCam: false,
    scenes: ["Main", "Break", "Ending"],
    items: {
      Main: [
        { id: 1, source: "Camera", enabled: true },
        { id: 2, source: "Logo", enabled: true },
      ],
      Break: [{ id: 3, source: "Logo", enabled: true }],
      Ending: [],
    },
    inputs: {
      Mic: { kind: "coreaudio_input_capture", muted: false, volumeDb: -6 },
      Desktop: { kind: "coreaudio_output_capture", muted: false, volumeDb: 0 },
      Camera: { kind: "av_capture_input", muted: null, volumeDb: 0 },
      Logo: { kind: "image_source", muted: null, volumeDb: 0 },
    },
    filters: { Mic: [{ name: "Noise Gate", enabled: true }], Camera: [] },
  };
}

const uuid = (name: string) => {
  const h = createHash("md5").update(name).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

const b64sha = (s: string) => createHash("sha256").update(s).digest("base64");

export class FakeObs {
  state = initialState();
  /** Every request a client sent, in order (batches flattened). */
  requests: { requestType: string; requestData?: Data }[] = [];
  readonly port: number;
  private readonly password: string;
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(port: number, password = "") {
    this.port = port;
    this.password = password;
    this.wss = new WebSocketServer({ port, host: "127.0.0.1" });
    this.wss.on("connection", (ws) => this.onConnection(ws));
  }

  reset() {
    this.state = initialState();
    this.requests = [];
  }

  close(): Promise<void> {
    for (const ws of this.clients) ws.terminate();
    return new Promise((resolve) => this.wss.close(() => resolve()));
  }

  /** Requests of one type the clients sent (newest last). */
  sent(requestType: string) {
    return this.requests.filter((r) => r.requestType === requestType);
  }

  private onConnection(ws: WebSocket) {
    const salt = randomBytes(32).toString("base64");
    const challenge = randomBytes(32).toString("base64");
    let identified = false;
    const hello: Data = { obsWebSocketVersion: "5.6.0", rpcVersion: 1 };
    if (this.password) hello.authentication = { challenge, salt };
    ws.send(JSON.stringify({ op: 0, d: hello }));

    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as { op: number; d: Data };
      if (msg.op === 1) {
        if (this.password) {
          const expected = b64sha(b64sha(this.password + salt) + challenge);
          if (msg.d.authentication !== expected) {
            ws.close(4009, "Authentication failed.");
            return;
          }
        }
        identified = true;
        this.clients.add(ws);
        ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
        return;
      }
      if (!identified) return;
      if (msg.op === 6) {
        const { requestType, requestId, requestData } = msg.d as {
          requestType: string;
          requestId: string;
          requestData?: Data;
        };
        const res = this.handle(requestType, requestData ?? {});
        ws.send(JSON.stringify({ op: 7, d: { requestType, requestId, ...res } }));
      } else if (msg.op === 8) {
        const { requestId, requests } = msg.d as {
          requestId: string;
          requests: { requestType: string; requestData?: Data }[];
        };
        const results = requests.map((r) => ({
          requestType: r.requestType,
          ...this.handle(r.requestType, r.requestData ?? {}),
        }));
        ws.send(JSON.stringify({ op: 9, d: { requestId, results } }));
      }
    });
    ws.on("close", () => this.clients.delete(ws));
  }

  emit(eventType: string, eventData: Data) {
    const text = JSON.stringify({ op: 5, d: { eventType, eventIntent: 0, eventData } });
    for (const ws of this.clients) ws.send(text);
  }

  private handle(
    requestType: string,
    d: Data,
  ): { requestStatus: { result: boolean; code: number; comment?: string }; responseData?: Data } {
    this.requests.push({ requestType, requestData: d });
    const ok = (responseData: Data = {}) => ({
      requestStatus: { result: true, code: 100 },
      responseData,
    });
    const fail = (comment: string) => ({ requestStatus: { result: false, code: 600, comment } });
    const s = this.state;
    const input = (name: unknown) => s.inputs[String(name)];

    switch (requestType) {
      case "GetVersion":
        return ok({ obsVersion: "32.2.2", obsWebSocketVersion: "5.6.0" });
      case "GetStreamStatus":
        return ok({ outputActive: s.streaming, outputDuration: 0 });
      case "GetRecordStatus":
        return ok({ outputActive: s.recording, outputPaused: s.recordPaused, outputDuration: 0 });
      case "GetVirtualCamStatus":
        return ok({ outputActive: s.virtualCam });
      case "GetReplayBufferStatus":
        return fail("Replay buffer is not available.");
      case "GetStudioModeEnabled":
        return ok({ studioModeEnabled: s.studio });
      case "GetSceneList":
        return ok({
          currentProgramSceneName: s.program,
          currentPreviewSceneName: s.preview,
          scenes: s.scenes.map((name, i) => ({
            sceneName: name,
            sceneUuid: uuid(name),
            sceneIndex: s.scenes.length - 1 - i,
          })),
        });
      case "GetSceneCollectionList":
        return ok({
          currentSceneCollectionName: "Event",
          sceneCollections: ["Event", "Rehearsal"],
        });
      case "GetProfileList":
        return ok({ currentProfileName: "Default", profiles: ["Default"] });
      case "GetSceneTransitionList":
        return ok({
          currentSceneTransitionName: "Fade",
          transitions: [{ transitionName: "Fade" }, { transitionName: "Cut" }],
        });
      case "GetHotkeyList":
        return ok({ hotkeys: ["OBSBasic.StartStreaming", "OBSBasic.Screenshot"] });
      case "GetInputList":
        return ok({
          inputs: Object.entries(s.inputs).map(([name, i]) => ({
            inputName: name,
            inputUuid: uuid(name),
            inputKind: i.kind,
            unversionedInputKind: i.kind,
          })),
        });
      case "GetSceneItemList": {
        const items = s.items[String(d.sceneName)];
        if (!items) return fail("No scene");
        return ok({
          sceneItems: items.map((i) => ({
            sceneItemId: i.id,
            sourceName: i.source,
            sceneItemEnabled: i.enabled,
          })),
        });
      }
      case "GetSourceFilterList":
        return ok({
          filters: (s.filters[String(d.sourceName)] ?? []).map((f) => ({
            filterName: f.name,
            filterEnabled: f.enabled,
          })),
        });
      case "GetInputMute": {
        const i = input(d.inputName);
        if (!i || i.muted === null) return fail("The specified input does not support audio.");
        return ok({ inputMuted: i.muted });
      }
      case "GetInputVolume": {
        const i = input(d.inputName);
        if (!i || i.muted === null) return fail("The specified input does not support audio.");
        return ok({ inputVolumeDb: i.volumeDb });
      }
      case "SetCurrentProgramScene": {
        const name = String(d.sceneName);
        if (!s.scenes.includes(name)) return fail("No source was found by the name of the scene.");
        s.program = name;
        this.emit("CurrentProgramSceneChanged", { sceneName: name, sceneUuid: uuid(name) });
        return ok();
      }
      case "ToggleStream":
      case "StartStream":
      case "StopStream": {
        const next = requestType === "ToggleStream" ? !s.streaming : requestType === "StartStream";
        s.streaming = next;
        this.emit("StreamStateChanged", {
          outputActive: next,
          outputState: next ? "OBS_WEBSOCKET_OUTPUT_STARTED" : "OBS_WEBSOCKET_OUTPUT_STOPPED",
        });
        return ok(requestType === "ToggleStream" ? { outputActive: next } : {});
      }
      case "ToggleRecord":
      case "StartRecord":
      case "StopRecord": {
        const next = requestType === "ToggleRecord" ? !s.recording : requestType === "StartRecord";
        s.recording = next;
        s.recordPaused = false;
        this.emit("RecordStateChanged", {
          outputActive: next,
          outputState: next ? "OBS_WEBSOCKET_OUTPUT_STARTED" : "OBS_WEBSOCKET_OUTPUT_STOPPED",
        });
        return ok();
      }
      case "SetInputMute": {
        const i = input(d.inputName);
        if (!i || i.muted === null) return fail("The specified input does not support audio.");
        i.muted = d.inputMuted === true;
        this.emit("InputMuteStateChanged", { inputName: d.inputName, inputMuted: i.muted });
        return ok();
      }
      case "SetInputVolume": {
        const i = input(d.inputName);
        if (!i || i.muted === null) return fail("The specified input does not support audio.");
        i.volumeDb = Number(d.inputVolumeDb);
        this.emit("InputVolumeChanged", {
          inputName: d.inputName,
          inputVolumeDb: i.volumeDb,
          inputVolumeMul: 1,
        });
        return ok();
      }
      case "SetSceneItemEnabled": {
        const item = s.items[String(d.sceneName)]?.find((i) => i.id === d.sceneItemId);
        if (!item) return fail("No scene item");
        item.enabled = d.sceneItemEnabled === true;
        this.emit("SceneItemEnableStateChanged", {
          sceneName: d.sceneName,
          sceneItemId: item.id,
          sceneItemEnabled: item.enabled,
        });
        return ok();
      }
      case "TriggerHotkeyByName":
        return ok();
      default:
        return {
          requestStatus: {
            result: false,
            code: 204,
            comment: `Unknown request type ${requestType}`,
          },
        };
    }
  }
}

if (process.argv[1]?.endsWith("fake-obs.ts")) {
  const port = Number(process.argv[2] ?? 4455);
  const fake = new FakeObs(port, process.argv[3] ?? "");
  console.log(`fake obs-websocket on ws://127.0.0.1:${port}`);
  process.on("SIGINT", () => void fake.close().then(() => process.exit(0)));
}
