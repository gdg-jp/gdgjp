import type * as schema from "~/db/schema";
import { ensureOpenReviewFlag } from "~/features/spaces/review.server";
import type { getDb } from "~/lib/db.server";
import type { SyncOperation } from "./cli-sync-schema";

type PageRow = typeof schema.pages.$inferSelect;

/**
 * The runner never overwrites a human page. Its operations on human pages are dropped from
 * the push and kept as a `human-page-conflict` review flag (with the proposed text), so the
 * rest of the push still applies and a person decides.
 */
export async function partitionRunnerOperations(
  db: ReturnType<typeof getDb>,
  spaceId: string,
  operations: readonly SyncOperation[],
  byId: ReadonlyMap<string, PageRow>,
): Promise<{ kept: SyncOperation[]; skipped: Array<{ id: string; reason: "human_page" }> }> {
  const kept: SyncOperation[] = [];
  const skipped: Array<{ id: string; reason: "human_page" }> = [];
  for (const operation of operations) {
    const targetId = operation.kind === "archive" ? operation.id : operation.page.id;
    const target = targetId ? byId.get(targetId) : undefined;
    if (!target || target.origin !== "human") {
      kept.push(operation);
      continue;
    }
    skipped.push({ id: target.id, reason: "human_page" });
    await ensureOpenReviewFlag(db, {
      spaceId,
      targetType: "page",
      targetId: target.id,
      kind: "human-page-conflict",
      payload:
        operation.kind === "archive"
          ? { action: "archive" }
          : {
              action: "update",
              proposed: {
                ja: operation.page.ja
                  ? { title: operation.page.ja.title, content: operation.page.ja.content }
                  : null,
                en: operation.page.en
                  ? { title: operation.page.en.title, content: operation.page.en.content }
                  : null,
              },
            },
    });
  }
  return { kept, skipped };
}
