import { and, eq } from "drizzle-orm";
import * as schema from "../../../../../../app/db/schema";
import type { CurrentSourceImport, SourceImportTickContext } from "../../run";
import { metaGet, metaSet } from "../../run";
import { driveMetadataUrl, expectedKind, fileId, requireToken } from "../drive-import-shared";

export async function stepMetadata(
  ctx: SourceImportTickContext,
  current: CurrentSourceImport,
): Promise<{ phaseComplete: boolean }> {
  if (metaGet(ctx.sql, "drive_mime_type")) return { phaseComplete: true };
  if (!ctx.budget.canSpend(2)) return { phaseComplete: false };
  ctx.budget.spend(1);
  const response = await fetch(driveMetadataUrl(fileId(current)), {
    headers: { Authorization: `Bearer ${requireToken(ctx)}` },
  });
  if (!response.ok) {
    throw new Error(
      `Google Drive file metadata failed (${response.status}): ${await response.text()}`,
    );
  }
  const metadata = (await response.json()) as { name?: string; mimeType?: string };
  const mimeType = metadata.mimeType || "";
  const kind = expectedKind(mimeType);
  const title = metadata.name?.trim() || current.source.title;

  if (title !== current.source.title || kind !== current.source.kind) {
    ctx.budget.spend(1);
    await current.db
      .update(schema.sources)
      .set({ title, kind, updatedAt: new Date() })
      .where(
        and(
          eq(schema.sources.id, current.source.id),
          eq(schema.sources.fetchAttemptId, current.run.fetchAttemptId),
        ),
      );
    current.source.title = title;
    current.source.kind = kind;
  }
  metaSet(ctx.sql, "drive_file_id", fileId(current));
  metaSet(ctx.sql, "drive_mime_type", mimeType);
  metaSet(ctx.sql, "drive_title", title);
  return { phaseComplete: true };
}
