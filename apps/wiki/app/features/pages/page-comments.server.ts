import { asc, eq, inArray } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { getDb } from "~/lib/db.server";

type WikiDb = ReturnType<typeof getDb>;

/** Comments of a page as a reply tree, with reaction counts (page loader). */
export async function loadPageComments(
  db: WikiDb,
  pageId: string,
  sessionUserId: string | undefined,
) {
  const commentsRaw = await db
    .select({
      id: schema.pageComments.id,
      authorId: schema.pageComments.authorId,
      authorName: schema.user.name,
      authorImage: schema.user.image,
      parentId: schema.pageComments.parentId,
      contentJson: schema.pageComments.contentJson,
      deletedAt: schema.pageComments.deletedAt,
      createdAt: schema.pageComments.createdAt,
    })
    .from(schema.pageComments)
    .innerJoin(schema.user, eq(schema.pageComments.authorId, schema.user.id))
    .where(eq(schema.pageComments.pageId, pageId))
    .orderBy(asc(schema.pageComments.createdAt))
    .all();

  const commentIds = commentsRaw.map((c) => c.id);
  const reactionsRaw =
    commentIds.length > 0
      ? await db
          .select()
          .from(schema.commentReactions)
          .where(inArray(schema.commentReactions.commentId, commentIds))
          .orderBy(asc(schema.commentReactions.createdAt))
          .all()
      : [];

  const reactionsByComment = new Map<
    string,
    { emoji: string; count: number; reactedByMe: boolean }[]
  >();
  for (const r of reactionsRaw) {
    const list = reactionsByComment.get(r.commentId) ?? [];
    const existing = list.find((x) => x.emoji === r.emoji);
    if (existing) {
      existing.count++;
      if (r.userId === sessionUserId) existing.reactedByMe = true;
    } else {
      list.push({ emoji: r.emoji, count: 1, reactedByMe: r.userId === sessionUserId });
    }
    reactionsByComment.set(r.commentId, list);
  }

  type ReactionGroup = { emoji: string; count: number; reactedByMe: boolean };
  type FlatComment = (typeof commentsRaw)[number] & {
    reactions: ReactionGroup[];
    replies: FlatComment[];
  };
  const flatComments: FlatComment[] = commentsRaw.map((c) => ({
    ...c,
    reactions: reactionsByComment.get(c.id) ?? [],
    replies: [],
  }));
  const commentMap = new Map<string, FlatComment>(flatComments.map((c) => [c.id, c]));
  const topLevelComments: FlatComment[] = [];
  for (const c of flatComments) {
    if (c.parentId) {
      commentMap.get(c.parentId)?.replies.push(c);
    } else {
      topLevelComments.push(c);
    }
  }
  return topLevelComments;
}
