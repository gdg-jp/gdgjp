import { and, eq, ne, notInArray } from "drizzle-orm";
import * as schema from "../../../../app/db/schema";
import type { getDb } from "../../../../app/lib/db.server";
import { isSourceFetchAttemptCurrent, sourceFetchAttemptIsCurrent } from "../persist";

/** Reconcile only while the owning fetch lease is current. */
export async function archiveMissingDocuments(
  db: ReturnType<typeof getDb>,
  sourceId: string,
  attemptId: string,
  fetchedPaths: readonly string[],
  /** When given, the archived documents' v2 objects are deleted from R2. */
  bucket?: R2Bucket,
): Promise<boolean> {
  if (!(await isSourceFetchAttemptCurrent(db, sourceId, attemptId))) return false;
  const stale =
    fetchedPaths.length === 0
      ? eq(schema.sourceDocuments.sourceId, sourceId)
      : and(
          eq(schema.sourceDocuments.sourceId, sourceId),
          notInArray(schema.sourceDocuments.path, [...fetchedPaths]),
        );
  // Archived documents leave the search index: drop their v2 objects (v1 `raw/` objects
  // are immutable history and are removed wholesale in Stage 07).
  const archivedKeys = await db
    .select({ r2Key: schema.sourceDocuments.r2Key })
    .from(schema.sourceDocuments)
    .where(and(stale, ne(schema.sourceDocuments.status, "archived")))
    .all();
  await db
    .update(schema.sourceDocuments)
    .set({ status: "archived" })
    .where(
      and(
        stale,
        ne(schema.sourceDocuments.status, "archived"),
        sourceFetchAttemptIsCurrent(sourceId, attemptId),
      ),
    );
  const stillCurrent = await isSourceFetchAttemptCurrent(db, sourceId, attemptId);
  const v2Keys = archivedKeys.map((row) => row.r2Key).filter((key) => key.startsWith("spaces/"));
  if (stillCurrent && bucket && v2Keys.length > 0) {
    for (let i = 0; i < v2Keys.length; i += 1000) await bucket.delete(v2Keys.slice(i, i + 1000));
  }
  return stillCurrent;
}
