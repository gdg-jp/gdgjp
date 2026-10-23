import { DurableObject } from "cloudflare:workers";
import { getDeck } from "../app/features/deck/decks.server";
import { type DeckLayout, emptyLayout } from "../app/features/deck/model";
import { type ObsState, emptyObsState } from "../app/features/obs/state";
import { resolvePress } from "../app/features/room/press";
import {
  CLOSE_DELETED,
  CLOSE_REPLACED,
  CLOSE_REVOKED,
  type ControllerMessage,
  type DeckInfo,
  type DeckSummary,
  type DockMessage,
  LOG_LIMIT,
  type LogEntry,
  PING,
  PONG,
  type Role,
  type ToControllerMessage,
  type ToDockMessage,
  parseJson,
} from "../app/features/room/protocol";

type Attachment = { role: Role; peerId: string; name: string };

type Stored = { deck: DeckInfo; layout: DeckLayout };

/** Headers the Worker sets after authenticating the socket (never trusted from clients). */
export const ROOM_HEADERS = {
  role: "x-deck-role",
  peerId: "x-deck-peer",
  name: "x-deck-name",
  deck: "x-deck-info",
} as const;

/**
 * One deck's live hub (`env.DECK.getByName(deckId)`): the OBS dock, every
 * controller, the last OBS snapshot, multi-action switch positions and the
 * operation log.
 *
 * - Sockets are hibernatable; per-socket identity lives in the attachment.
 * - The saved layout is cached here and re-read from D1 whenever a socket
 *   arrives with a newer version, or the Worker says it changed.
 * - At most one dock: a new one replaces the old.
 */
export class DeckRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  private get stored(): Stored | null {
    return this.ctx.storage.kv.get<Stored>("deck") ?? null;
  }

  private get obs(): ObsState {
    return this.ctx.storage.kv.get<ObsState>("obs") ?? emptyObsState();
  }

  private get switches(): Record<string, boolean> {
    return this.ctx.storage.kv.get<Record<string, boolean>>("switches") ?? {};
  }

  private get log(): LogEntry[] {
    return this.ctx.storage.kv.get<LogEntry[]>("log") ?? [];
  }

  private async reload(deckId: string): Promise<Stored | null> {
    const row = await getDeck(this.env.DB, deckId);
    if (!row) return null;
    const stored: Stored = {
      deck: { id: row.id, name: row.name, version: row.version },
      layout: row.layout,
    };
    this.ctx.storage.kv.put("deck", stored);
    return stored;
  }

  // ─── RPC (from the Worker) ───────────────────────────────────────────────

  /** The layout or name was saved: re-read it and push it to every controller. */
  async layoutChanged(deckId: string): Promise<void> {
    const stored = await this.reload(deckId);
    if (!stored) return;
    this.toControllers({ type: "layout", deck: stored.deck, layout: stored.layout });
    this.toDock({ type: "hello", deck: stored.deck, log: this.log });
  }

  async summary(): Promise<DeckSummary> {
    const obs = this.obs;
    const dockOnline = this.dockSockets().length > 0;
    return {
      dockOnline,
      obsConnected: dockOnline && obs.connected,
      streaming: dockOnline && obs.streaming,
      recording: dockOnline && obs.recording,
    };
  }

  /** Drop the dock after its token was reissued. */
  async revokeDock(): Promise<void> {
    for (const ws of this.ctx.getWebSockets("dock")) {
      try {
        ws.close(CLOSE_REVOKED, "revoked");
      } catch {
        // already closed
      }
    }
  }

  async destroy(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE_DELETED, "deleted");
      } catch {
        // already closed
      }
    }
    this.ctx.storage.kv.delete("deck");
    this.ctx.storage.kv.delete("obs");
    this.ctx.storage.kv.delete("switches");
    this.ctx.storage.kv.delete("log");
  }

  // ─── transport ───────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const role = request.headers.get(ROOM_HEADERS.role) as Role | null;
    const info = parseJson<DeckInfo>(
      decodeURIComponent(request.headers.get(ROOM_HEADERS.deck) ?? ""),
    );
    const peerId = request.headers.get(ROOM_HEADERS.peerId) ?? "";
    if ((role !== "controller" && role !== "dock") || !info || !peerId) {
      return new Response("bad request", { status: 400 });
    }
    let stored = this.stored;
    if (
      !stored ||
      stored.deck.id !== info.id ||
      stored.deck.version < info.version ||
      stored.deck.name !== info.name
    ) {
      stored = await this.reload(info.id);
    }
    if (!stored) return new Response("no deck", { status: 404 });
    const name = decodeURIComponent(request.headers.get(ROOM_HEADERS.name) ?? "").slice(0, 60);

    if (role === "dock") {
      for (const old of this.dockSockets()) {
        try {
          old.close(CLOSE_REPLACED, "replaced");
        } catch {
          // already closed
        }
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, peerId, name } satisfies Attachment);

    if (role === "dock") {
      this.send(server, {
        type: "hello",
        deck: stored.deck,
        log: this.log,
      } satisfies ToDockMessage);
      this.toControllers({ type: "dock", online: true });
    } else {
      const dockOnline = this.dockSockets().length > 0;
      const obs = this.obs;
      this.send(server, {
        type: "hello",
        deck: stored.deck,
        layout: stored.layout,
        obs: dockOnline ? obs : { ...obs, connected: false },
        dockOnline,
        switches: this.switches,
        log: this.log,
        serverNow: Date.now(),
      } satisfies ToControllerMessage);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    if (att.role === "dock") {
      if (!this.dockSockets().includes(ws)) return;
      const msg = parseJson<DockMessage>(raw);
      if (msg) this.onDock(msg);
      return;
    }
    const msg = parseJson<ControllerMessage>(raw);
    if (msg) this.onController(att, msg);
  }

  private onController(att: Attachment, msg: ControllerMessage) {
    if (msg.type === "refresh") {
      this.toDock({ type: "refresh" });
      return;
    }
    if (msg.type !== "press" && msg.type !== "volume") return;
    const stored = this.stored;
    if (!stored || typeof msg.keyId !== "string") return;
    const result = resolvePress(stored.layout, this.switches, msg);
    if (!result.ok) {
      if (result.error !== "ignored") {
        this.appendLog({
          keyId: msg.keyId,
          title: "",
          by: att.name,
          status: "error",
          error: result.error,
        });
      }
      return;
    }
    const { run } = result;
    // Slider drags and key releases are not worth a log line each.
    const quiet = msg.type === "volume" || run.phase === "up";
    const dock = this.dockSockets()[0];
    if (!dock) {
      if (!quiet) {
        this.appendLog({
          keyId: run.key.id,
          title: run.key.title,
          by: att.name,
          status: "error",
          error: "OBS のドックが接続されていません",
        });
      }
      return;
    }
    if (run.switches !== this.switches) {
      this.ctx.storage.kv.put("switches", run.switches);
      this.toControllers({ type: "switches", switches: run.switches });
    }
    const runId = quiet
      ? `q-${crypto.randomUUID()}`
      : this.appendLog({
          keyId: run.key.id,
          title: run.key.title,
          by: att.name,
          status: "pending",
          error: null,
        });
    this.send(dock, {
      type: "run",
      runId,
      steps: run.steps,
      phase: run.phase,
      ...(run.value === undefined ? {} : { value: run.value }),
    } satisfies ToDockMessage);
  }

  private onDock(msg: DockMessage) {
    if (msg.type === "state" && msg.obs && typeof msg.obs === "object") {
      const skew = typeof msg.dockNow === "number" ? Date.now() - msg.dockNow : 0;
      const shift = (t: number | null) => (typeof t === "number" ? t + skew : null);
      const obs: ObsState = {
        ...msg.obs,
        streamSince: shift(msg.obs.streamSince),
        recordSince: shift(msg.obs.recordSince),
      };
      this.ctx.storage.kv.put("obs", obs);
      this.toControllers({ type: "obs", obs, serverNow: Date.now() });
      return;
    }
    if (msg.type === "result" && typeof msg.runId === "string") {
      this.updateLog(
        msg.runId,
        msg.ok ? "ok" : "error",
        msg.ok ? null : String(msg.error ?? "失敗しました").slice(0, 300),
      );
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.onGone(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye");
    } catch {
      // already closed
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.onGone(ws);
  }

  private onGone(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att?.role !== "dock") return;
    if (this.dockSockets().some((other) => other !== ws)) return;
    this.ctx.storage.kv.put("obs", { ...this.obs, connected: false });
    for (const entry of this.log) {
      if (entry.status === "pending") this.updateLog(entry.id, "error", "ドックが切断されました");
    }
    this.toControllers({ type: "dock", online: false });
  }

  // ─── log ─────────────────────────────────────────────────────────────────

  private appendLog(input: Omit<LogEntry, "id" | "at">): string {
    const entry: LogEntry = { id: crypto.randomUUID(), at: Date.now(), ...input };
    const log = [...this.log, entry].slice(-LOG_LIMIT);
    this.ctx.storage.kv.put("log", log);
    this.toAll({ type: "log", entry });
    return entry.id;
  }

  private updateLog(id: string, status: LogEntry["status"], error: string | null) {
    const log = this.log;
    const index = log.findIndex((e) => e.id === id);
    const current = log[index];
    if (!current) return;
    const entry: LogEntry = { ...current, status, error };
    log[index] = entry;
    this.ctx.storage.kv.put("log", log);
    this.toAll({ type: "log", entry });
  }

  // ─── sending ─────────────────────────────────────────────────────────────

  private dockSockets(): WebSocket[] {
    return this.ctx
      .getWebSockets("dock")
      .filter((ws) => ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);
  }

  private send(ws: WebSocket, msg: ToControllerMessage | ToDockMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // closing; webSocketClose cleans up
    }
  }

  private toControllers(msg: ToControllerMessage) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets("controller")) {
      try {
        ws.send(text);
      } catch {
        // closing
      }
    }
  }

  private toDock(msg: ToDockMessage) {
    for (const ws of this.dockSockets()) this.send(ws, msg);
  }

  private toAll(msg: Extract<ToControllerMessage, { type: "log" }>) {
    this.toControllers(msg);
    this.toDock(msg);
  }
}
