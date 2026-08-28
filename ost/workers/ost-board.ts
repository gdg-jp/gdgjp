import { DurableObject } from "cloudflare:workers";
import { autoAssign, rankUnits } from "../app/lib/assign";
import { buildUnits } from "../app/lib/scoring";
import {
  type BoardMessage,
  type Desk,
  type Group,
  MAX_TOPIC_LENGTH,
  type OstBoardState,
  type Topic,
} from "../app/lib/topics";
import { ensureOstBoardSchema } from "./ost-board-schema";

type TopicRow = {
  id: string;
  text: string;
  created_at: number;
  group_id: string | null;
  desk_id: string | null;
};
type GroupRow = { id: string; label: string | null; created_at: number };
type DeskRow = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  sort_order: number;
  created_at: number;
};

export type DeskInput = {
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  label?: string;
};
export type DeskPatch = Partial<Pick<Desk, "x" | "y" | "width" | "height" | "rotation" | "label">>;

/**
 * One board per OST event. Addressed as `env.OST_BOARD.getByName(slug)`.
 *
 * Topics, votes, merge groups and desks live in this DO's own SQLite (no D1).
 * Every connected client (`/ws?board=<slug>`) holds a hibernatable WebSocket
 * and receives the full {@link OstBoardState} on connect and after every
 * mutation. Participants submit / vote via route actions -> RPC; the sockets
 * are push-only.
 */
export class OstBoard extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ensureOstBoardSchema(this.ctx.storage.sql);
    });
  }

  // ─── Reads ──────────────────────────────────────────────────────────────────

  listState(): OstBoardState {
    return this.snapshot();
  }

  private snapshot(): OstBoardState {
    const topics = this.ctx.storage.sql
      .exec<TopicRow>(
        "SELECT id, text, created_at, group_id, desk_id FROM topics ORDER BY created_at ASC, id ASC",
      )
      .toArray()
      .map(
        (r): Topic => ({
          id: r.id,
          text: r.text,
          createdAt: r.created_at,
          groupId: r.group_id,
          deskId: r.desk_id,
        }),
      );

    const groups = this.ctx.storage.sql
      .exec<GroupRow>("SELECT id, label, created_at FROM groups ORDER BY created_at ASC, id ASC")
      .toArray()
      .map((r): Group => ({ id: r.id, label: r.label, createdAt: r.created_at }));

    const desks = this.ctx.storage.sql
      .exec<DeskRow>(
        "SELECT id, label, x, y, width, height, rotation, sort_order, created_at FROM desks ORDER BY sort_order ASC, created_at ASC",
      )
      .toArray()
      .map(
        (r): Desk => ({
          id: r.id,
          label: r.label,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          rotation: r.rotation,
          sortOrder: r.sort_order,
          createdAt: r.created_at,
        }),
      );

    const voteCounts: Record<string, number> = {};
    for (const row of this.ctx.storage.sql
      .exec<{ topic_id: string; n: number }>(
        "SELECT topic_id, COUNT(*) AS n FROM votes GROUP BY topic_id",
      )
      .toArray()) {
      voteCounts[row.topic_id] = row.n;
    }

    return { topics, groups, desks, voteCounts };
  }

  listVotesFor(voterId: string): string[] {
    if (!voterId) return [];
    return this.ctx.storage.sql
      .exec<{ topic_id: string }>("SELECT topic_id FROM votes WHERE voter_id = ?", voterId)
      .toArray()
      .map((r) => r.topic_id);
  }

  // ─── Topics ─────────────────────────────────────────────────────────────────

  /** Append a topic. `text` is expected to be pre-normalized by the caller. */
  submitTopic(text: string): Topic {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_TOPIC_LENGTH);
    if (clean.length === 0) throw new Error("empty topic");
    const topic: Topic = {
      id: crypto.randomUUID(),
      text: clean,
      createdAt: Date.now(),
      groupId: null,
      deskId: null,
    };
    this.ctx.storage.sql.exec(
      "INSERT INTO topics (id, text, created_at, group_id, desk_id) VALUES (?, ?, ?, NULL, NULL)",
      topic.id,
      topic.text,
      topic.createdAt,
    );
    this.touch();
    return topic;
  }

  deleteTopic(id: string): void {
    const row = this.ctx.storage.sql
      .exec<{ group_id: string | null }>("SELECT group_id FROM topics WHERE id = ?", id)
      .toArray()[0];
    this.ctx.storage.sql.exec("DELETE FROM votes WHERE topic_id = ?", id);
    this.ctx.storage.sql.exec("DELETE FROM topics WHERE id = ?", id);
    if (row?.group_id) this.dissolveGroupIfTooSmall(row.group_id);
    this.touch();
  }

  clearTopics(): void {
    this.ctx.storage.sql.exec("DELETE FROM votes");
    this.ctx.storage.sql.exec("DELETE FROM topics");
    this.ctx.storage.sql.exec("DELETE FROM groups");
    this.touch();
  }

  // ─── Votes ──────────────────────────────────────────────────────────────────

  /** Toggle one voter's 👍 on one topic. Returns the resulting state. */
  toggleVote(topicId: string, voterId: string): { voted: boolean } {
    if (!voterId) throw new Error("missing voter id");
    const exists = this.ctx.storage.sql
      .exec("SELECT 1 FROM topics WHERE id = ?", topicId)
      .toArray()[0];
    if (!exists) return { voted: false };

    const had = this.ctx.storage.sql
      .exec("SELECT 1 FROM votes WHERE topic_id = ? AND voter_id = ?", topicId, voterId)
      .toArray()[0];
    if (had) {
      this.ctx.storage.sql.exec(
        "DELETE FROM votes WHERE topic_id = ? AND voter_id = ?",
        topicId,
        voterId,
      );
      this.touch();
      return { voted: false };
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO votes (topic_id, voter_id, created_at) VALUES (?, ?, ?)",
      topicId,
      voterId,
      Date.now(),
    );
    this.touch();
    return { voted: true };
  }

  // ─── Merge groups ───────────────────────────────────────────────────────────

  mergeTopics(sourceId: string, targetId: string): void {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const rows = this.ctx.storage.sql
      .exec<{ id: string; group_id: string | null }>(
        "SELECT id, group_id FROM topics WHERE id IN (?, ?)",
        sourceId,
        targetId,
      )
      .toArray();
    const source = rows.find((r) => r.id === sourceId);
    const target = rows.find((r) => r.id === targetId);
    if (!source || !target) return;
    if (source.group_id && source.group_id === target.group_id) return;

    let groupId: string;
    if (target.group_id) {
      groupId = target.group_id;
    } else if (source.group_id) {
      groupId = source.group_id;
    } else {
      groupId = crypto.randomUUID();
      this.ctx.storage.sql.exec(
        "INSERT INTO groups (id, label, created_at) VALUES (?, NULL, ?)",
        groupId,
        Date.now(),
      );
    }

    // Move both topics (and, if the source carried a group, its whole group)
    // into `groupId`.
    if (source.group_id && source.group_id !== groupId) {
      const old = source.group_id;
      this.ctx.storage.sql.exec("UPDATE topics SET group_id = ? WHERE group_id = ?", groupId, old);
      this.ctx.storage.sql.exec("DELETE FROM groups WHERE id = ?", old);
    }
    this.ctx.storage.sql.exec(
      "UPDATE topics SET group_id = ? WHERE id IN (?, ?)",
      groupId,
      sourceId,
      targetId,
    );
    this.touch();
  }

  ungroupTopic(topicId: string): void {
    const row = this.ctx.storage.sql
      .exec<{ group_id: string | null }>("SELECT group_id FROM topics WHERE id = ?", topicId)
      .toArray()[0];
    if (!row?.group_id) return;
    const groupId = row.group_id;
    this.ctx.storage.sql.exec("UPDATE topics SET group_id = NULL WHERE id = ?", topicId);
    this.dissolveGroupIfTooSmall(groupId);
    this.touch();
  }

  private dissolveGroupIfTooSmall(groupId: string): void {
    const n = Number(
      (
        this.ctx.storage.sql
          .exec<{ n: number }>("SELECT COUNT(*) AS n FROM topics WHERE group_id = ?", groupId)
          .toArray()[0] ?? { n: 0 }
      ).n,
    );
    if (n < 2) {
      this.ctx.storage.sql.exec("UPDATE topics SET group_id = NULL WHERE group_id = ?", groupId);
      this.ctx.storage.sql.exec("DELETE FROM groups WHERE id = ?", groupId);
    }
  }

  // ─── Desks ──────────────────────────────────────────────────────────────────

  addDesk(input: DeskInput): Desk {
    const nextOrder =
      Number(
        (
          this.ctx.storage.sql
            .exec<{ m: number | null }>("SELECT MAX(sort_order) AS m FROM desks")
            .toArray()[0] ?? { m: null }
        ).m ?? -1,
      ) + 1;
    const desk: Desk = {
      id: crypto.randomUUID(),
      label: input.label ?? "",
      x: input.x,
      y: input.y,
      width: input.width ?? 160,
      height: input.height ?? 100,
      rotation: input.rotation ?? 0,
      sortOrder: nextOrder,
      createdAt: Date.now(),
    };
    this.ctx.storage.sql.exec(
      `INSERT INTO desks (id, label, x, y, width, height, rotation, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      desk.id,
      desk.label,
      desk.x,
      desk.y,
      desk.width,
      desk.height,
      desk.rotation,
      desk.sortOrder,
      desk.createdAt,
    );
    this.touch();
    return desk;
  }

  updateDesk(id: string, patch: DeskPatch): void {
    const fields: string[] = [];
    const values: (string | number)[] = [];
    for (const key of ["x", "y", "width", "height", "rotation", "label"] as const) {
      const v = patch[key];
      if (v === undefined) continue;
      fields.push(`${key === "label" ? "label" : key} = ?`);
      values.push(v);
    }
    if (fields.length === 0) return;
    values.push(id);
    this.ctx.storage.sql.exec(`UPDATE desks SET ${fields.join(", ")} WHERE id = ?`, ...values);
    this.touch();
  }

  removeDesk(id: string): void {
    this.ctx.storage.sql.exec("UPDATE topics SET desk_id = NULL WHERE desk_id = ?", id);
    this.ctx.storage.sql.exec("DELETE FROM desks WHERE id = ?", id);
    this.touch();
  }

  reorderDesks(ids: string[]): void {
    ids.forEach((id, i) => {
      this.ctx.storage.sql.exec("UPDATE desks SET sort_order = ? WHERE id = ?", i, id);
    });
    this.touch();
  }

  // ─── Assignment ─────────────────────────────────────────────────────────────

  autoAssignDesks(): void {
    const state = this.snapshot();
    this.ctx.storage.sql.exec("UPDATE topics SET desk_id = NULL");
    const units = buildUnits(state.topics, state.groups);
    const ranked = rankUnits(units, state.voteCounts);
    const assignment = autoAssign(ranked, state.desks);
    const unitById = new Map(units.map((u) => [u.id, u]));
    for (const [deskId, unitId] of assignment) {
      const unit = unitById.get(unitId);
      if (!unit) continue;
      for (const topicId of unit.memberIds) {
        this.ctx.storage.sql.exec("UPDATE topics SET desk_id = ? WHERE id = ?", deskId, topicId);
      }
    }
    this.touch();
  }

  clearAssignments(): void {
    this.ctx.storage.sql.exec("UPDATE topics SET desk_id = NULL");
    this.touch();
  }

  // ─── WebSocket transport ────────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify(this.stateMessage()));
    return new Response(null, { status: 101, webSocket: client });
  }

  // The clients are push-only; ignore anything they send.
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

  private stateMessage(): BoardMessage {
    return { type: "state", state: this.snapshot() };
  }

  private touch(): void {
    const payload = JSON.stringify(this.stateMessage());
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // dropped; the close handler cleans it up
      }
    }
  }
}
