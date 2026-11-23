import { DurableObject } from "cloudflare:workers";
import {
  type DurableObjectSnapshot,
  exportDurableObjectStorage,
  restoreDurableObject,
} from "@gdgjp/gdg-lib/staging-snapshot";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { createAuth } from "../app/features/auth/auth.server";
import { canonicalMarkdown } from "../app/features/editor/content-format";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

const PERSIST_DEBOUNCE_MS = 10_000;
const ALARM_INTERVAL_MS = 60_000;
const KV_KEY = "yjs-state";

interface UserInfo {
  userId: string;
  userName: string;
  userImage: string | null;
}

export class CollabDurableObject extends DurableObject<Env> {
  private ydoc: Y.Doc;
  private awareness: awarenessProtocol.Awareness;
  private connections: Map<WebSocket, UserInfo> = new Map();
  private wsToClientId: Map<WebSocket, number> = new Map();
  private dirty = false;
  private persistPending = false;
  private initialized = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    [this.ydoc, this.awareness] = this.createDocument();
  }

  private createDocument(): [Y.Doc, awarenessProtocol.Awareness] {
    const ydoc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(ydoc);

    ydoc.on("update", (update: Uint8Array, origin: unknown) => {
      this.dirty = true;
      const originWs = origin as WebSocket;
      if (!this.connections.has(originWs)) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      this.broadcast(message, originWs);
    });

    awareness.on(
      "update",
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        if (origin instanceof WebSocket) {
          for (const clientId of added.concat(updated)) {
            this.wsToClientId.set(origin, clientId);
          }
        }

        const changedClients = added.concat(updated, removed);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
        );
        const senderWs = origin instanceof WebSocket ? origin : undefined;
        this.broadcast(encoding.toUint8Array(encoder), senderWs);
      },
    );
    return [ydoc, awareness];
  }

  async exportStagingSnapshot(): Promise<DurableObjectSnapshot> {
    return exportDurableObjectStorage(this.ctx.storage);
  }

  async importStagingSnapshot(snapshot: DurableObjectSnapshot): Promise<void> {
    await restoreDurableObject(this.ctx, this.env, snapshot);
    this.connections.clear();
    this.wsToClientId.clear();
    this.awareness.destroy();
    this.ydoc.destroy();
    [this.ydoc, this.awareness] = this.createDocument();
    this.dirty = false;
    this.persistPending = false;
    this.initialized = false;
  }

  private async initialize(spaceSlug: string, slug: string): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const stored = await this.ctx.storage.get<ArrayBuffer>(KV_KEY);
    if (stored) {
      Y.applyUpdate(this.ydoc, new Uint8Array(stored));
      return;
    }

    const row = await this.env.DB.prepare(
      `SELECT pages.content_ja, pages.content_en FROM pages
       JOIN spaces ON spaces.id = pages.space_id
       WHERE spaces.slug = ? AND pages.slug = ?`,
    )
      .bind(spaceSlug, slug)
      .first<{ content_ja: string | null; content_en: string | null }>();

    if (row) {
      this.ydoc.transact(() => {
        if (row.content_ja) {
          this.ydoc.getText("contentJa").insert(0, canonicalMarkdown(row.content_ja));
        }
        if (row.content_en) {
          this.ydoc.getText("contentEn").insert(0, canonicalMarkdown(row.content_en));
        }
      });
    }

    this.dirty = false;
  }

  private async authenticate(request: Request): Promise<UserInfo | null> {
    const user = await createAuth(this.env).getSessionUser(request);
    if (!user) return null;

    return {
      userId: user.id,
      userName: user.name,
      userImage: user.image,
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/access-changed") {
      for (const ws of this.connections.keys()) {
        ws.close(4003, "Page permissions changed");
      }
      return new Response(null, { status: 204 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const user = await this.authenticate(request);
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const [, , , rawSpace, rawSlug] = url.pathname.split("/");
    const spaceSlug = rawSpace ? decodeURIComponent(rawSpace) : "";
    const slug = rawSlug ? decodeURIComponent(rawSlug) : "";
    if (!spaceSlug || !slug) return new Response("Missing slug", { status: 400 });

    await this.initialize(spaceSlug, slug);

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.ctx.acceptWebSocket(server);
    this.connections.set(server, user);

    const currentAlarm = await this.ctx.storage.getAlarm();
    if (!currentAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }

    this.ctx.waitUntil(this.sendInitialSync(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  private async sendInitialSync(ws: WebSocket): Promise<void> {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep2(encoder, this.ydoc);
    ws.send(encoding.toUint8Array(encoder));

    const awarenessStates = this.awareness.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(awarenessStates.keys())),
      );
      ws.send(encoding.toUint8Array(awarenessEncoder));
    }
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message === "string") return;
    const data = new Uint8Array(message);
    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MSG_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, this.ydoc, ws);
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder));
        }
        break;
      }
      case MSG_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, ws);
        break;
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.connections.delete(ws);

    const clientId = this.wsToClientId.get(ws);
    if (clientId !== undefined) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [clientId], "close");
      this.wsToClientId.delete(ws);
    }

    if (this.connections.size === 0) {
      await this.persist();
    } else {
      await this.schedulePersist();
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  async alarm(): Promise<void> {
    this.persistPending = false;
    if (this.dirty) {
      await this.persist();
    }
    if (this.connections.size > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }

  private broadcast(message: Uint8Array, exclude?: WebSocket): void {
    for (const ws of this.connections.keys()) {
      if (ws !== exclude) {
        try {
          ws.send(message);
        } catch {}
      }
    }
  }

  private async schedulePersist(): Promise<void> {
    if (this.persistPending) return;
    this.persistPending = true;
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (!currentAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + PERSIST_DEBOUNCE_MS);
    }
  }

  private async persist(): Promise<void> {
    if (!this.dirty) return;
    const state = Y.encodeStateAsUpdate(this.ydoc);
    await this.ctx.storage.put(
      KV_KEY,
      state.buffer.slice(state.byteOffset, state.byteOffset + state.byteLength),
    );
    this.dirty = false;
  }
}
