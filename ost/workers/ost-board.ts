import { DurableObject } from "cloudflare:workers";
import { type BoardMessage, MAX_TOPIC_LENGTH, type Topic } from "../app/lib/topics";

type TopicRow = {
  id: string;
  text: string;
  created_at: number;
};

/**
 * Single board for the running OST session.
 *
 * Addressed as `env.OST_BOARD.getByName("default")`. Topics live in the DO's own
 * SQLite storage (no D1). Admin projector screens hold a hibernatable WebSocket
 * to `/ws` and receive {@link BoardMessage} events; participants never connect a
 * socket — their submissions come in as RPC calls from the route action.
 */
export class OstBoard extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS topics (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
      );
    });
  }

  /** Append a topic. `text` is expected to be pre-normalized by the caller. */
  submitTopic(text: string): Topic {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_TOPIC_LENGTH);
    if (clean.length === 0) {
      throw new Error("empty topic");
    }
    const topic: Topic = {
      id: crypto.randomUUID(),
      text: clean,
      createdAt: Date.now(),
    };
    this.ctx.storage.sql.exec(
      "INSERT INTO topics (id, text, created_at) VALUES (?, ?, ?)",
      topic.id,
      topic.text,
      topic.createdAt,
    );
    this.broadcast({ type: "added", topic });
    return topic;
  }

  listTopics(): Topic[] {
    const rows = this.ctx.storage.sql
      .exec<TopicRow>("SELECT id, text, created_at FROM topics ORDER BY created_at ASC, id ASC")
      .toArray();
    return rows.map((row) => ({ id: row.id, text: row.text, createdAt: row.created_at }));
  }

  deleteTopic(id: string): void {
    this.ctx.storage.sql.exec("DELETE FROM topics WHERE id = ?", id);
    this.broadcast({ type: "deleted", id });
  }

  clearTopics(): void {
    this.ctx.storage.sql.exec("DELETE FROM topics");
    this.broadcast({ type: "cleared" });
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.send(
      JSON.stringify({ type: "snapshot", topics: this.listTopics() } satisfies BoardMessage),
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  // The admin screen is read-only; ignore anything it sends.
  async webSocketMessage(_ws: WebSocket, _message: ArrayBuffer | string): Promise<void> {}

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // already closing
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, "socket error");
    } catch {
      // already closing
    }
  }

  private broadcast(message: BoardMessage): void {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // dropped; the close handler cleans it up
      }
    }
  }
}
