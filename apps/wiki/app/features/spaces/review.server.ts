import { and, desc, eq, isNull } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { getDb } from "~/lib/db.server";

type Db = ReturnType<typeof getDb>;

export type ReviewFlagKind =
  | "human-page-conflict"
  | "acl-untagged"
  | "acl-ambiguous-span"
  | "broken-link"
  | "translate-stuck";

export type ReviewFlag = typeof schema.reviewFlags.$inferSelect;

export async function createReviewFlag(
  db: Db,
  flag: {
    spaceId: string;
    targetType: "page" | "source" | "job";
    targetId: string;
    kind: ReviewFlagKind;
    payload?: unknown;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.reviewFlags).values({
    id,
    spaceId: flag.spaceId,
    targetType: flag.targetType,
    targetId: flag.targetId,
    kind: flag.kind,
    payload: JSON.stringify(flag.payload ?? {}),
  });
  return id;
}

export async function listOpenReviewFlags(db: Db, spaceId: string): Promise<ReviewFlag[]> {
  return db
    .select()
    .from(schema.reviewFlags)
    .where(and(eq(schema.reviewFlags.spaceId, spaceId), isNull(schema.reviewFlags.resolvedAt)))
    .orderBy(desc(schema.reviewFlags.createdAt))
    .limit(200)
    .all();
}

export async function getReviewFlag(
  db: Db,
  spaceId: string,
  flagId: string,
): Promise<ReviewFlag | undefined> {
  return db
    .select()
    .from(schema.reviewFlags)
    .where(and(eq(schema.reviewFlags.spaceId, spaceId), eq(schema.reviewFlags.id, flagId)))
    .get();
}

export async function resolveReviewFlag(
  db: Db,
  spaceId: string,
  flagId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .update(schema.reviewFlags)
    .set({ resolvedAt: new Date(), resolvedBy: userId })
    .where(
      and(
        eq(schema.reviewFlags.spaceId, spaceId),
        eq(schema.reviewFlags.id, flagId),
        isNull(schema.reviewFlags.resolvedAt),
      ),
    );
  return (result.meta?.changes ?? 0) > 0;
}

/** Create the flag unless an open one of the same kind already exists for the target. */
export async function ensureOpenReviewFlag(
  db: Db,
  flag: Parameters<typeof createReviewFlag>[1],
): Promise<string | null> {
  const existing = await db
    .select({ id: schema.reviewFlags.id })
    .from(schema.reviewFlags)
    .where(
      and(
        eq(schema.reviewFlags.spaceId, flag.spaceId),
        eq(schema.reviewFlags.targetType, flag.targetType),
        eq(schema.reviewFlags.targetId, flag.targetId),
        eq(schema.reviewFlags.kind, flag.kind),
        isNull(schema.reviewFlags.resolvedAt),
      ),
    )
    .get();
  if (existing) return null;
  return createReviewFlag(db, flag);
}
