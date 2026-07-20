import { DurableObject } from "cloudflare:workers";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { createAuth } from "../app/lib/auth.server";
import { tiptapToMarkdown } from "../app/lib/tiptap-convert";

// Wire protocol message types
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

/**
 * Durable Object for realtime collaborative editing.
 *
 * Uses the Hibernation API (state.acceptWebSocket / webSocketMessage / webSocketClose)
 * so that idle connections don't consume CPU.
 *
 * Each instance is identified by a page slug and maintains:
 * - A Y.Doc with getText("contentJa") and getText("contentEn")
 * - An Awareness instance for presence tracking
 * - Persisted Y.Doc state in DO KV storage
 */
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
    this.ydoc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.ydoc);

    // Listen for Y.Doc updates to broadcast and mark dirty
    this.ydoc.on("update", (update: Uint8Array, origin: unknown) => {
      this.dirty = true;
      // Only broadcast updates that came from a client WebSocket (not local initialization)
      const originWs = origin as WebSocket;
      if (!this.connections.has(originWs)) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      this.broadcast(message, originWs);
    });

    // Listen for awareness updates to broadcast (origin is the sender WebSocket)
    this.awareness.on(
      "update",
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        // Track WebSocket → clientId mapping from incoming awareness updates
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
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
        );
        // Exclude the sender to avoid echoing back
        const senderWs = origin instanceof WebSocket ? origin : undefined;
        this.broadcast(encoding.toUint8Array(encoder), senderWs);
      },
    );
  }

  /**
   * Load persisted Y.Doc state from DO KV storage, falling back to D1 page content.
   */
  private async initialize(slug: string): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Try loading from DO KV storage first
    const stored = await this.ctx.storage.get<ArrayBuffer>(KV_KEY);
    if (stored) {
      Y.applyUpdate(this.ydoc, new Uint8Array(stored));
      return;
    }

    // Fall back to D1 content
    const row = await this.env.DB.prepare("SELECT content_ja, content_en FROM pages WHERE slug = ?")
      .bind(slug)
      .first<{ content_ja: string | null; content_en: string | null }>();

    if (row) {
      this.ydoc.transact(() => {
        if (row.content_ja) {
          this.ydoc.getText("contentJa").insert(0, tiptapToMarkdown(row.content_ja));
        }
        if (row.content_en) {
          this.ydoc.getText("contentEn").insert(0, tiptapToMarkdown(row.content_en));
        }
      });
    }

    this.dirty = false;
  }

  /**
   * Validate session cookie and return user info.
   */
  private async authenticate(request: Request): Promise<UserInfo | null> {
    const user = await createAuth(this.env).getSessionUser(request);
    if (!user) return null;
    // Any signed-in user can join collab; per-chapter / role gating moved
    // to the accounts IdP and is no longer enforced in the Durable Object.

    return {
      userId: user.id,
      userName: user.name,
      userImage: user.image,
    };
  }

  /**
   * Handle WebSocket upgrade request.
   */
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

    // Extract slug from URL
    const slug = url.pathname.split("/")[3];
    if (!slug) return new Response("Missing slug", { status: 400 });

    await this.initialize(slug);

    // Create WebSocket pair and accept with Hibernation API
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.ctx.acceptWebSocket(server);
    this.connections.set(server, user);

    // Schedule alarm for periodic persistence
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (!currentAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }

    // Send initial sync state to the new client
    this.ctx.waitUntil(this.sendInitialSync(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Send initial document state + full awareness state to a newly connected client.
   */
  private async sendInitialSync(ws: WebSocket): Promise<void> {
    // Send sync step 2 (full server state) so the client receives current content immediately.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep2(encoder, this.ydoc);
    ws.send(encoding.toUint8Array(encoder));

    // Send current awareness state
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

  /**
   * Handle incoming WebSocket message (Hibernation API).
   */
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
        // applyAwarenessUpdate triggers the "update" listener which handles broadcasting
        // and tracks the WebSocket → clientId mapping
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, ws);
        break;
      }
    }
  }

  /**
   * Handle WebSocket close (Hibernation API).
   */
  async webSocketClose(ws: WebSocket): Promise<void> {
    this.connections.delete(ws);

    // Remove awareness state for this client's tracked clientId
    const clientId = this.wsToClientId.get(ws);
    if (clientId !== undefined) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [clientId], "close");
      this.wsToClientId.delete(ws);
    }

    // If no more connections, persist immediately
    if (this.connections.size === 0) {
      await this.persist();
    } else {
      await this.schedulePersist();
    }
  }

  /**
   * Handle WebSocket error (Hibernation API).
   */
  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /**
   * Alarm handler for periodic persistence.
   */
  async alarm(): Promise<void> {
    this.persistPending = false;
    if (this.dirty) {
      await this.persist();
    }
    // Reschedule if there are still active connections
    if (this.connections.size > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }

  /**
   * Broadcast a message to all connected clients, optionally excluding one.
   */
  private broadcast(message: Uint8Array, exclude?: WebSocket): void {
    for (const ws of this.connections.keys()) {
      if (ws !== exclude) {
        try {
          ws.send(message);
        } catch {
          // Connection likely closed; will be cleaned up in webSocketClose
        }
      }
    }
  }

  /**
   * Schedule debounced persistence via alarm (survives hibernation).
   */
  private async schedulePersist(): Promise<void> {
    if (this.persistPending) return;
    this.persistPending = true;
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (!currentAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + PERSIST_DEBOUNCE_MS);
    }
  }

  /**
   * Persist Y.Doc state to DO KV storage.
   */
  private async persist(): Promise<void> {
    if (!this.dirty) return;
    const state = Y.encodeStateAsUpdate(this.ydoc);
    // Persist exact slice to avoid extra bytes from shared ArrayBuffer
    await this.ctx.storage.put(
      KV_KEY,
      state.buffer.slice(state.byteOffset, state.byteOffset + state.byteLength),
    );
    this.dirty = false;
  }
}
