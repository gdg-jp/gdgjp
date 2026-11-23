import { and, eq, like, ne } from "drizzle-orm";
import * as schema from "../../../../app/db/schema";
import { documentFirstWeek } from "../chat-periods";
import { type CurrentSourceImport, type SourceImportTickContext, metaGet, metaSet } from "./run";

export async function resolveOpenDocument(
  ctx: SourceImportTickContext,
  current: CurrentSourceImport,
  options: { pathPrefix: string; fallbackWeek: string | null },
): Promise<string | null> {
  const cached = metaGet(ctx.sql, "open_week");
  if (cached) return cached;
  if (!ctx.budget.canSpend(1)) return null;
  ctx.budget.spend(1);
  const rows = current.run.sinceCursor
    ? await current.db
        .select({ path: schema.sourceDocuments.path })
        .from(schema.sourceDocuments)
        .where(
          and(
            eq(schema.sourceDocuments.sourceId, current.source.id),
            eq(schema.sourceDocuments.cursor, current.run.sinceCursor),
            like(schema.sourceDocuments.path, `${options.pathPrefix}%`),
            ne(schema.sourceDocuments.status, "archived"),
          ),
        )
        .all()
    : [];
  const open = rows
    .flatMap((row) => {
      const week = documentFirstWeek(row.path);
      return week ? [{ path: row.path, week }] : [];
    })
    .sort((a, b) => a.week.localeCompare(b.week))
    .at(-1);
  const week = open?.week ?? options.fallbackWeek;
  if (!week) throw new Error("Unable to find the newest document of an incremental import");
  if (open) metaSet(ctx.sql, "open_path", open.path);
  metaSet(ctx.sql, "open_week", week);
  return week;
}
