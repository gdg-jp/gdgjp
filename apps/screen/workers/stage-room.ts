import { DurableObject } from "cloudflare:workers";
import {
  type DurableObjectSnapshot,
  exportDurableObjectStorage,
  restoreDurableObject,
} from "@gdgjp/gdg-lib/staging-snapshot";
import {
  CLOSE_DELETED,
  CLOSE_REPLACED,
  CLOSE_REVOKED,
  type ClientMessage,
  PING,
  PONG,
  type Role,
  type Slot,
  type StageMeta,
  type ToClientMessage,
  isSlot,
  parseJson,
} from "../app/features/stage/protocol";
import {
  type RoomData,
  type Sender,
  type StageSummary,
  applyMessage,
  cleanName,
  connectPeer,
  disconnectPeer,
  emptyRoom,
  operatorView,
  outputView,
  speakerView,
  summarize,
} from "../app/features/stage/room-state";

type Attachment = {
  role: Role;
  peerId: string;
  name: string;
  slot: Slot | null;
};

export const ROOM_HEADERS = {
  role: "x-screen-role",
  peerId: "x-screen-peer",
  name: "x-screen-name",
  meta: "x-screen-meta",
  slot: "x-screen-slot",
} as const;

export class StageRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  private load(): RoomData {
    return this.ctx.storage.kv.get<RoomData>("room") ?? emptyRoom();
  }

  private save(data: RoomData) {
    this.ctx.storage.kv.put("room", data);
  }

  private get meta(): StageMeta | null {
    return this.ctx.storage.kv.get<StageMeta>("meta") ?? null;
  }

  async configure(meta: StageMeta): Promise<void> {
    this.ctx.storage.kv.put("meta", meta);
    this.broadcast();
  }

  async summary(meta: StageMeta): Promise<StageSummary> {
    return summarize(this.load(), meta);
  }

  async revoke(role: "speaker" | "output"): Promise<void> {
    for (const ws of this.ctx.getWebSockets(role)) {
      try {
        ws.close(CLOSE_REVOKED, "revoked");
      } catch {}
    }
  }

  async destroy(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE_DELETED, "deleted");
      } catch {}
    }
    this.ctx.storage.kv.delete("room");
    this.ctx.storage.kv.delete("meta");
  }

  async exportStagingSnapshot(): Promise<DurableObjectSnapshot> {
    return exportDurableObjectStorage(this.ctx.storage);
  }

  async importStagingSnapshot(snapshot: DurableObjectSnapshot): Promise<void> {
    await restoreDurableObject(this.ctx, this.env, snapshot);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const role = request.headers.get(ROOM_HEADERS.role) as Role | null;
    const meta = parseJson<StageMeta>(request.headers.get(ROOM_HEADERS.meta) ?? "");
    if (!role || !meta) return new Response("bad request", { status: 400 });
    this.ctx.storage.kv.put("meta", meta);

    const slotHeader = request.headers.get(ROOM_HEADERS.slot);
    const slot = isSlot(slotHeader) ? slotHeader : null;
    if (role === "output" && !slot) return new Response("bad slot", { status: 400 });
    const peerId =
      role === "output"
        ? `out:${crypto.randomUUID()}`
        : (request.headers.get(ROOM_HEADERS.peerId) ?? "");
    if (!peerId) return new Response("bad peer", { status: 400 });
    const name = cleanName(decodeURIComponent(request.headers.get(ROOM_HEADERS.name) ?? ""));

    if (role !== "output") {
      for (const old of this.ctx.getWebSockets(`peer:${peerId}`)) {
        const att = old.deserializeAttachment() as Attachment | null;
        if (att) old.serializeAttachment({ ...att, peerId: `${att.peerId}#replaced` });
        try {
          old.close(CLOSE_REPLACED, "replaced");
        } catch {}
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [role, `peer:${peerId}`]);
    const attachment: Attachment = { role, peerId, name, slot };
    server.serializeAttachment(attachment);

    if (role !== "output") {
      this.save(connectPeer(this.load(), { id: peerId, role, name }, Date.now()));
      this.broadcast();
    } else {
      this.sendView(server, attachment, this.load(), meta, Date.now());
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    const meta = this.meta;
    if (!att || !meta || att.role === "output") return;
    const msg = parseJson<ClientMessage>(raw);
    if (!msg || typeof msg !== "object") return;
    const data = this.load();
    const peer = data.peers[att.peerId];
    const sender: Sender = { id: att.peerId, role: att.role, name: peer?.name ?? att.name };
    const result = applyMessage(data, meta, sender, msg, Date.now());
    if (!result.changed) return;
    this.save(result.data);
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.onGone(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye");
    } catch {}
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.onGone(ws);
  }

  private onGone(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || att.role === "output") return;
    const stillHere = this.ctx
      .getWebSockets(`peer:${att.peerId}`)
      .some((other) => other !== ws && other.readyState === WebSocket.OPEN);
    if (stillHere) return;
    const data = this.load();
    if (!data.peers[att.peerId]) return;
    this.save(disconnectPeer(data, att.peerId, Date.now()));
    this.broadcast();
  }

  private broadcast() {
    const meta = this.meta;
    if (!meta) return;
    const data = this.load();
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att) this.sendView(ws, att, data, meta, now);
    }
  }

  private sendView(ws: WebSocket, att: Attachment, data: RoomData, meta: StageMeta, now: number) {
    let message: ToClientMessage;
    if (att.role === "operator") {
      message = { type: "state", view: operatorView(data, meta, att.peerId, now) };
    } else if (att.role === "speaker") {
      message = { type: "state", view: speakerView(data, meta, att.peerId, now) };
    } else if (att.slot) {
      message = { type: "state", view: outputView(data, att.slot, now) };
    } else {
      return;
    }
    try {
      ws.send(JSON.stringify(message));
    } catch {}
  }
}
