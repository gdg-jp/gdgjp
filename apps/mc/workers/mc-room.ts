import { DurableObject } from "cloudflare:workers";
import {
  type Catalog,
  type Clip,
  type UploadedClip,
  buildCatalog,
  playableOn,
} from "../app/features/clips/catalog";
import { listUploaded } from "../app/features/clips/uploads.server";
import {
  type ControllerMessage,
  type LogEntry,
  MAX_LOOP_GAP_SEC,
  PING,
  PONG,
  type PlayerMessage,
  type PlayerPresence,
  type RoomConfig,
  type ToControllerMessage,
  type ToPlayerMessage,
  parseJson,
} from "../app/features/playback/protocol";

type Role = "controller" | "player";

type Attachment = {
  role: Role;
  connId: string;
  connectedAt: number;
  lastSeenAt: number;
  state: PlayerPresence["state"];
};

const LOG_LIMIT = 200;

export class McRoom extends DurableObject<Env> {
  private pending = new Map<string, string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  private get token(): string {
    let token = this.ctx.storage.kv.get<string>("token");
    if (!token) {
      token = randomToken();
      this.ctx.storage.kv.put("token", token);
    }
    return token;
  }

  private get config(): RoomConfig {
    return {
      played: this.ctx.storage.kv.get<RoomConfig["played"]>("played") ?? {},
      loops: this.ctx.storage.kv.get<RoomConfig["loops"]>("loops") ?? {},
    };
  }

  private get uploaded(): UploadedClip[] {
    return this.ctx.storage.kv.get<UploadedClip[]>("uploaded") ?? [];
  }

  private catalogCache: { key: string; catalog: Catalog } | null = null;

  private get catalog(): Catalog {
    const uploaded = this.uploaded;
    const key = JSON.stringify(uploaded.map((c) => [c.id, c.track, c.after]));
    if (this.catalogCache?.key !== key) {
      this.catalogCache = { key, catalog: buildCatalog(uploaded) };
    }
    return this.catalogCache.catalog;
  }

  private getClip(id: string): Clip | undefined {
    return this.catalog.get(id);
  }

  async refreshCatalog(track?: string): Promise<void> {
    if (track && this.ctx.storage.kv.get<string>("track") !== track) {
      this.ctx.storage.kv.put("track", track);
    }
    const clips = await listUploaded(this.env.DB);
    if (JSON.stringify(clips) === JSON.stringify(this.uploaded)) return;
    this.ctx.storage.kv.put("uploaded", clips);
    this.broadcast("controller", { type: "catalog", clips });
    this.broadcast("player", { type: "catalog", clips });
  }

  private get log(): LogEntry[] {
    return this.ctx.storage.kv.get<LogEntry[]>("log") ?? [];
  }

  private appendLog(entry: Omit<LogEntry, "at">) {
    const full: LogEntry = { at: Date.now(), ...entry };
    const log = this.log;
    log.push(full);
    this.ctx.storage.kv.put("log", log.slice(-LOG_LIMIT));
    this.broadcast("controller", { type: "log", entry: full });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    if (role !== "controller" && role !== "player") {
      return new Response("bad role", { status: 400 });
    }
    const track = url.searchParams.get("track");
    if (track && this.ctx.storage.kv.get<string>("track") !== track) {
      this.ctx.storage.kv.put("track", track);
    }
    if (role === "player" && !timingSafeEqual(url.searchParams.get("t") ?? "", this.token)) {
      return new Response("bad token", { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const now = Date.now();
    const attachment: Attachment = {
      role,
      connId: crypto.randomUUID().slice(0, 8),
      connectedAt: now,
      lastSeenAt: now,
      state: null,
    };
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment(attachment);

    if (role === "controller") {
      this.send(server, {
        type: "snapshot",
        serverNow: now,
        token: this.token,
        config: this.config,
        players: this.players(),
        log: this.log,
        clips: this.uploaded,
      });
    } else {
      this.send(server, { type: "catalog", clips: this.uploaded });
      this.send(server, { type: "config", config: this.config });
      this.appendLog({ level: "info", code: "player-connected", detail: attachment.connId });
      this.broadcast("controller", {
        type: "player",
        serverNow: now,
        presence: presenceOf(attachment),
      });
    }
    this.ctx.waitUntil(
      this.refreshCatalog().catch((err) =>
        this.appendLog({ level: "warn", code: "catalog-refresh-failed", detail: String(err) }),
      ),
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    if (att.role === "player") this.onPlayerMessage(ws, att, parseJson<PlayerMessage>(raw));
    else this.onControllerMessage(att, parseJson<ControllerMessage>(raw));
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.onGone(ws, code);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye");
    } catch {}
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.onGone(ws, 1006);
  }

  private onGone(ws: WebSocket, code: number) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att?.role !== "player") return;
    this.appendLog({
      level: "warn",
      code: "player-disconnected",
      detail: `${att.connId} (${code})`,
    });
    this.broadcast("controller", { type: "playerGone", connId: att.connId });
  }

  private onControllerMessage(att: Attachment, msg: ControllerMessage | null) {
    if (!msg) return;
    switch (msg.type) {
      case "cmd": {
        const { id, cmd } = msg;
        const clip = cmd.kind === "play" ? this.getClip(cmd.clipId) : undefined;
        if (cmd.kind === "play" && (!clip || !this.serves(clip))) {
          this.reply(att.connId, { type: "result", id, ok: false, reason: "unknown-clip" });
          return;
        }
        const players = this.ctx.getWebSockets("player");
        if (players.length === 0) {
          this.appendLog({ level: "error", code: "cmd-no-player", detail: cmd.kind });
          this.reply(att.connId, { type: "result", id, ok: false, reason: "no-player" });
          return;
        }
        this.pending.set(id, att.connId);
        setTimeout(() => this.pending.delete(id), 10_000);
        for (const ws of players) this.send(ws, { type: "cmd", id, cmd });
        this.appendLog({
          level: "info",
          code: "cmd",
          detail: cmd.kind === "play" ? `play ${cmd.clipId}` : cmd.kind,
        });
        return;
      }
      case "setLoop": {
        const loopClip = this.getClip(msg.clipId);
        if (!loopClip || !this.serves(loopClip)) return;
        const loops = this.config.loops;
        loops[msg.clipId] = {
          enabled: Boolean(msg.setting.enabled),
          gapSec: Math.min(MAX_LOOP_GAP_SEC, Math.max(0, Math.round(msg.setting.gapSec) || 0)),
        };
        this.ctx.storage.kv.put("loops", loops);
        this.broadcastConfig();
        return;
      }
      case "setPlayed": {
        this.setPlayed(msg.clipId, msg.value);
        return;
      }
      case "resetPlayed": {
        this.ctx.storage.kv.put("played", {});
        this.broadcastConfig();
        return;
      }
      case "probe": {
        this.broadcast("player", { type: "probe" });
        return;
      }
      case "rotateToken": {
        const token = randomToken();
        this.ctx.storage.kv.put("token", token);
        for (const ws of this.ctx.getWebSockets("player")) ws.close(4001, "token rotated");
        this.appendLog({ level: "warn", code: "token-rotated" });
        this.broadcast("controller", { type: "token", token });
        return;
      }
    }
  }

  private serves(clip: Clip): boolean {
    const track = this.ctx.storage.kv.get<string>("track");
    return track ? playableOn(clip, track) : true;
  }

  private setPlayed(clipId: string, value: boolean) {
    const clip = this.getClip(clipId);
    if (!clip || clip.track === null) return;
    const played = this.config.played;
    if (value === Boolean(played[clipId])) return;
    if (value) played[clipId] = true;
    else delete played[clipId];
    this.ctx.storage.kv.put("played", played);
    this.broadcastConfig();
  }

  private onPlayerMessage(ws: WebSocket, att: Attachment, msg: PlayerMessage | null) {
    if (!msg) return;
    const now = Date.now();
    att.lastSeenAt = now;
    if (msg.type === "log") {
      ws.serializeAttachment(att);
      this.appendLog({ ...msg.entry, detail: `${att.connId}: ${msg.entry.detail ?? ""}` });
      return;
    }
    att.state = msg.state;
    ws.serializeAttachment(att);
    this.broadcast("controller", { type: "player", serverNow: now, presence: presenceOf(att) });

    if (msg.type !== "ack") return;
    const controller = this.pending.get(msg.id);
    if (!controller) return;
    this.pending.delete(msg.id);
    if (msg.ok) {
      this.reply(controller, { type: "result", id: msg.id, ok: true });
      if (msg.state.clipId && (msg.state.status === "playing" || msg.state.status === "gap")) {
        this.setPlayed(msg.state.clipId, true);
      }
    } else {
      this.appendLog({ level: "error", code: `ack-${msg.reason}`, detail: msg.detail });
      this.reply(controller, {
        type: "result",
        id: msg.id,
        ok: false,
        reason: msg.reason,
        detail: msg.detail,
      });
    }
  }

  private players(): PlayerPresence[] {
    return this.ctx
      .getWebSockets("player")
      .map((ws) => ws.deserializeAttachment() as Attachment | null)
      .filter((a): a is Attachment => a !== null)
      .map(presenceOf);
  }

  private broadcastConfig() {
    const config = this.config;
    this.broadcast("controller", { type: "config", config });
    this.broadcast("player", { type: "config", config });
  }

  private reply(connId: string, msg: ToControllerMessage) {
    for (const ws of this.ctx.getWebSockets("controller")) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att?.connId === connId) this.send(ws, msg);
    }
  }

  private broadcast(role: "controller", msg: ToControllerMessage): void;
  private broadcast(role: "player", msg: ToPlayerMessage): void;
  private broadcast(role: Role, msg: ToControllerMessage | ToPlayerMessage) {
    for (const ws of this.ctx.getWebSockets(role)) this.send(ws, msg);
  }

  private send(ws: WebSocket, msg: ToControllerMessage | ToPlayerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }
}

function presenceOf(att: Attachment): PlayerPresence {
  return {
    connId: att.connId,
    connectedAt: att.connectedAt,
    lastSeenAt: att.lastSeenAt,
    state: att.state,
  };
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
