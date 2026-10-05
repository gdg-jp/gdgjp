import type { Comment } from "~/features/links/link-record";
import type { CommentRow } from "~/features/links/link-record";
import { toComment } from "~/features/links/link-record";
import { COMMENT_COLS } from "~/features/links/link-record";

// ---------- Comments ----------

export async function listComments(db: D1Database, linkId: string): Promise<Comment[]> {
  const { results } = await db
    .prepare(`SELECT ${COMMENT_COLS} FROM comments WHERE link_id = ? ORDER BY created_at`)
    .bind(linkId)
    .all<CommentRow>();
  return results.map(toComment);
}

export async function addComment(
  db: D1Database,
  input: { linkId: string; authorUserId: string; body: string },
): Promise<Comment> {
  const row = await db
    .prepare(
      `INSERT INTO comments (link_id, author_user_id, body)
       VALUES (?, ?, ?)
       RETURNING ${COMMENT_COLS}`,
    )
    .bind(input.linkId, input.authorUserId, input.body)
    .first<CommentRow>();
  if (!row) throw new Error("Insert returned no row");
  return toComment(row);
}

export async function deleteComment(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
}

/** Replaces one author's comment atomically; an empty body removes it. */
export async function replaceCommentForAuthor(
  db: D1Database,
  input: { linkId: string; authorUserId: string; body: string },
): Promise<void> {
  const statements = [
    db
      .prepare("DELETE FROM comments WHERE link_id = ? AND author_user_id = ?")
      .bind(input.linkId, input.authorUserId),
  ];
  if (input.body) {
    statements.push(
      db
        .prepare("INSERT INTO comments (link_id, author_user_id, body) VALUES (?, ?, ?)")
        .bind(input.linkId, input.authorUserId, input.body),
    );
  }
  await db.batch(statements);
}
