/**
 * The OBS custom dock's engine: one obs-websocket connection to the local OBS
 * and one socket to the deck's room on deck.gdgs.jp.
 *
 * - Keeps an ObsState (full read on connect and after structural changes,
 *   patched from events) and sends it to the room, throttled.
 * - Runs the steps the room sends, one run at a time, and reports the result.
 */

import type { Step } from "~/features/deck/model";
import { ObsClient, type ObsStatus } from "~/features/obs/obs-client";
import { BASE_REQUESTS, applyEvent, readBase, readDetails } from "~/features/obs/obs-events";
import { ActionError, type Phase, toRequests } from "~/features/obs/requests";
import { type ObsState, emptyObsState } from "~/features/obs/state";
import {
  type DeckInfo,
  type DockMessage,
  type LogEntry,
  type ToDockMessage,
  parseJson,
} from "~/features/room/protocol";
import { ReliableSocket, type SocketStatus } from "~/features/room/reliable-socket";
import { socketUrl, upsertLog } from "~/features/room/use-deck-room";

export type DockSettings = { obsUrl: string; password: string; screenshotDir: string };

export type DockSnapshot = {
  room: SocketStatus;
  rejected: number | null;
  obs: ObsStatus;
  obsDetail: string | null;
  deck: DeckInfo | null;
  log: LogEntry[];
  state: ObsState;
};

const PUSH_THROTTLE_MS = 100;
const REFRESH_DEBOUNCE_MS = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class DockEngine {
  private snapshot: DockSnapshot = {
    room: "connecting",
    rejected: null,
    obs: "connecting",
    obsDetail: null,
    deck: null,
    log: [],
    state: emptyObsState(),
  };
  private readonly room: ReliableSocket;
  private readonly obs: ObsClient;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private lastPush = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshing: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly opts: {
      deckId: string;
      token: string;
      settings: () => DockSettings;
      onChange: (snapshot: DockSnapshot) => void;
    },
  ) {
    this.room = new ReliableSocket({
      url: () => socketUrl({ deck: opts.deckId, role: "dock", t: opts.token }),
      onStatus: (room) => this.update({ room }),
      onOpen: () => {
        this.update({ rejected: null });
        this.pushNow();
      },
      onRejected: (rejected) => this.update({ rejected }),
      onMessage: (data) => {
        const msg = parseJson<ToDockMessage>(data);
        if (msg) this.onRoom(msg);
      },
    });
    this.obs = new ObsClient({
      url: () => opts.settings().obsUrl,
      password: () => opts.settings().password,
      onStatus: (obs, detail) => {
        this.update({ obs, obsDetail: detail ?? null });
        if (obs !== "open" && this.snapshot.state.connected) {
          this.setState({ ...this.snapshot.state, connected: false });
        }
      },
      onIdentified: () => void this.refresh(),
      onEvent: (type, data) => this.onObsEvent(type, data),
    });
  }

  start() {
    this.room.start();
    this.obs.start();
  }

  stop() {
    clearTimeout(this.pushTimer);
    clearTimeout(this.refreshTimer);
    this.room.stop();
    this.obs.stop();
  }

  /** Settings changed: reconnect to OBS. */
  reconnectObs() {
    this.obs.restart();
  }

  private update(patch: Partial<DockSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.opts.onChange(this.snapshot);
  }

  private setState(state: ObsState) {
    this.update({ state });
    this.schedulePush();
  }

  // ─── room ────────────────────────────────────────────────────────────────

  private onRoom(msg: ToDockMessage) {
    switch (msg.type) {
      case "hello":
        this.update({ deck: msg.deck, log: msg.log });
        return;
      case "log":
        this.update({ log: upsertLog(this.snapshot.log, msg.entry) });
        return;
      case "refresh":
        void this.refresh();
        return;
      case "run":
        this.queue = this.queue.then(() => this.run(msg.runId, msg.steps, msg.phase, msg.value));
        return;
    }
  }

  private sendRoom(msg: DockMessage) {
    this.room.send(JSON.stringify(msg));
  }

  private schedulePush() {
    if (this.pushTimer) return;
    const wait = Math.max(0, PUSH_THROTTLE_MS - (Date.now() - this.lastPush));
    this.pushTimer = setTimeout(() => {
      this.pushTimer = undefined;
      this.pushNow();
    }, wait);
  }

  private pushNow() {
    this.lastPush = Date.now();
    this.sendRoom({ type: "state", obs: this.snapshot.state, dockNow: Date.now() });
  }

  private async run(runId: string, steps: Step[], phase: Phase, value?: number) {
    try {
      for (const step of steps) {
        if (step.type === "wait") {
          await sleep(step.ms);
          continue;
        }
        const requests = toRequests(step.action, {
          state: this.snapshot.state,
          phase,
          value,
          screenshotDir: this.opts.settings().screenshotDir,
          now: new Date(),
        });
        for (const req of requests) await this.obs.request(req.requestType, req.requestData);
      }
      this.sendRoom({ type: "result", runId, ok: true, error: null });
    } catch (e) {
      const error = e instanceof ActionError || e instanceof Error ? e.message : String(e);
      this.sendRoom({ type: "result", runId, ok: false, error });
    }
  }

  // ─── OBS ─────────────────────────────────────────────────────────────────

  private onObsEvent(type: string, data: Record<string, unknown>) {
    const effect = applyEvent(this.snapshot.state, type, data, Date.now());
    if (effect.state !== this.snapshot.state) this.setState(effect.state);
    if (effect.refresh) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => void this.refresh(), REFRESH_DEBOUNCE_MS);
    }
    if (effect.media) void this.readMedia(effect.media);
  }

  private async readMedia(inputName: string) {
    try {
      const res = await this.obs.request<{ mediaState?: string }>("GetMediaInputStatus", {
        inputName,
      });
      const input = this.snapshot.state.inputs[inputName];
      if (input) {
        this.setState({
          ...this.snapshot.state,
          inputs: {
            ...this.snapshot.state.inputs,
            [inputName]: { ...input, media: res.mediaState ?? null },
          },
        });
      }
    } catch {
      // gone or not a media input
    }
  }

  /** Re-reads everything from OBS (two request batches). */
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const base = readBase(await this.obs.batch([...BASE_REQUESTS]), Date.now());
        const details = await this.obs.batch(base.detailRequests);
        this.setState(readDetails(base.state, base.detailRequests, details));
      } catch {
        // disconnected mid-read; the next Identified reads again
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }
}
