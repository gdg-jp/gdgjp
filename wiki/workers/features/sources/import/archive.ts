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
): Promise<boolean> {
  if (!(await isSourceFetchAttemptCurrent(db, sourceId, attemptId))) return false;
  const stale =
    fetchedPaths.length === 0
      ? eq(schema.sourceDocuments.sourceId, sourceId)
      : and(
          eq(schema.sourceDocuments.sourceId, sourceId),
          notInArray(schema.sourceDocuments.path, [...fetchedPaths]),
        );
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
  return isSourceFetchAttemptCurrent(db, sourceId, attemptId);
}
