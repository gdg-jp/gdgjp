import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

import type { ChunkMetadata } from "../acl/frontmatter.ts";

export const DEFAULT_DATABASE_PATH = "/var/lib/agents-index/index.db";

export type StoredChunk = ChunkMetadata & {
  id: number;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  distance: number;
};

type Row = {
  id: number;
  path: string;
  start_line: number;
  end_line: number;
  text: string;
  metadata: string;
  distance: number;
};

export class IndexStore {
  private readonly db: Database.Database;

  constructor(path = DEFAULT_DATABASE_PATH) {
    this.db = new Database(path);
    sqliteVec.load(this.db);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        text TEXT NOT NULL,
        metadata TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(embedding float[384]);
    `);
  }

  replacePath(
    path: string,
    chunks: Array<Omit<StoredChunk, "id" | "distance"> & { embedding: Float32Array }>,
  ): void {
    const replace = this.db.transaction(() => {
      const existing = this.db.prepare("SELECT id FROM chunks WHERE path = ?").all(path) as Array<{
        id: number;
      }>;
      for (const row of existing)
        this.db.prepare("DELETE FROM chunk_vectors WHERE rowid = ?").run(row.id);
      this.db.prepare("DELETE FROM chunks WHERE path = ?").run(path);
      const insert = this.db.prepare(
        "INSERT INTO chunks(id, path, start_line, end_line, text, metadata) VALUES (?, ?, ?, ?, ?, ?)",
      );
      const vector = this.db.prepare("INSERT INTO chunk_vectors(embedding) VALUES (?)");
      for (const chunk of chunks) {
        const vectorResult = vector.run(chunk.embedding);
        const result = insert.run(
          Number(vectorResult.lastInsertRowid),
          chunk.path,
          chunk.startLine,
          chunk.endLine,
          chunk.text,
          JSON.stringify({ subject: chunk.subject, aclSourceIds: chunk.aclSourceIds }),
        );
        if (Number(result.lastInsertRowid) !== Number(vectorResult.lastInsertRowid)) {
          throw new Error("Chunk and vector identifiers diverged");
        }
      }
    });
    replace();
  }

  removePath(path: string): void {
    this.replacePath(path, []);
  }

  search(embedding: Float32Array, offset: number, limit: number): StoredChunk[] {
    const rows = this.db
      .prepare(`
      SELECT c.id, c.path, c.start_line, c.end_line, c.text, c.metadata, v.distance
      FROM chunk_vectors v JOIN chunks c ON c.id = v.rowid
        WHERE v.embedding MATCH ? AND k = ?
      ORDER BY v.distance LIMIT ? OFFSET ?
    `)
      .all(
        Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength),
        Math.max(offset + limit, 1),
        limit,
        offset,
      ) as Row[];
    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      text: row.text,
      distance: row.distance,
      ...(JSON.parse(row.metadata) as ChunkMetadata),
    }));
  }

  close(): void {
    this.db.close();
  }
}
