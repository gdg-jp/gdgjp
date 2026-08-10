import { and, eq } from "drizzle-orm";
import * as schema from "../../../../../app/db/schema";
import { MARKDOWN_MEDIA_TYPE, markdownBody, pathForMediaType } from "../../media-type";
import { persistSourceDocument } from "../../persist";
import { fetchWebsiteSource } from "../../website";
import { archiveMissingDocuments } from "../archive";
import {
  ARCHIVE_MISSING_SUBREQUESTS,
  type CurrentSourceImport,
  PERSIST_REPLACE_SUBREQUESTS,
  type SourceImportStepOutcome,
  type SourceImportTickContext,
  metaGet,
  metaSet,
} from "../run";
import type { ImportKindDriver } from "../tick";

const WEBSITE_DOCUMENT_KEY = "website_document";
const WEBSITE_TITLE_KEY = "website_title";

type WebsitePhase = "content" | "finalizing";

export const websiteImportDriver: ImportKindDriver<WebsitePhase> = {
  kind: "website",
  phases: ["content", "finalizing"],
  needsAccessToken: false,
  requiredScopes: [],
  async step(phase, ctx, current) {
    if (phase === "content") return fetchContent(ctx, current);
    return finalize(ctx, current);
  },
  async complete(ctx, current) {
    if (!ctx.budget.canSpend(ARCHIVE_MISSING_SUBREQUESTS + 2)) {
      throw new Error("Website import complete called without enough subrequest budget");
    }
    const stored = metaGet(ctx.sql, WEBSITE_DOCUMENT_KEY);
    if (!stored) throw new Error("Website import has no staged document");
    const document = JSON.parse(stored) as { path: string };
    const path = pathForMediaType(document.path, MARKDOWN_MEDIA_TYPE);
    ctx.budget.spend(ARCHIVE_MISSING_SUBREQUESTS);
    if (
      !(await archiveMissingDocuments(current.db, current.source.id, current.run.fetchAttemptId, [
        path,
      ]))
    ) {
      return;
    }
    ctx.budget.spend(1);
    await current.db
      .update(schema.sources)
      .set({
        title: metaGet(ctx.sql, WEBSITE_TITLE_KEY) ?? current.source.title,
        status: "ready",
        fetchAttemptId: null,
        errorMessage: null,
        lastFetchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.sources.id, current.source.id),
          eq(schema.sources.fetchAttemptId, current.run.fetchAttemptId),
          eq(schema.sources.status, "fetching"),
        ),
      );
  },
};

async function fetchContent(
  ctx: SourceImportTickContext,
  current: CurrentSourceImport,
): Promise<SourceImportStepOutcome> {
  if (metaGet(ctx.sql, WEBSITE_DOCUMENT_KEY)) return { phaseComplete: true };
  if (!ctx.budget.canSpend(1)) return { phaseComplete: false };
  ctx.budget.spend(1);
  const fetched = await fetchWebsiteSource(current.source.url, ctx.env.BROWSER);
  const document = fetched.documents[0];
  if (!document) throw new Error("Website source returned no document");
  metaSet(ctx.sql, WEBSITE_DOCUMENT_KEY, JSON.stringify(document));
  metaSet(ctx.sql, WEBSITE_TITLE_KEY, fetched.title);
  return { phaseComplete: true };
}

async function finalize(
  ctx: SourceImportTickContext,
  current: CurrentSourceImport,
): Promise<SourceImportStepOutcome> {
  if (metaGet(ctx.sql, "website_finalized") === "1") {
    return { phaseComplete: ctx.budget.canSpend(ARCHIVE_MISSING_SUBREQUESTS + 2) };
  }
  if (!ctx.budget.canSpend(PERSIST_REPLACE_SUBREQUESTS)) return { phaseComplete: false };
  const stored = metaGet(ctx.sql, WEBSITE_DOCUMENT_KEY);
  if (!stored) throw new Error("Website import has no staged document");
  const document = JSON.parse(stored) as {
    path: string;
    title: string;
    markdown: string;
  };
  ctx.budget.spend(PERSIST_REPLACE_SUBREQUESTS);
  const persisted = await persistSourceDocument(ctx.env, {
    sourceId: current.source.id,
    fetchAttemptId: current.run.fetchAttemptId,
    path: pathForMediaType(document.path, MARKDOWN_MEDIA_TYPE),
    title: document.title,
    body: markdownBody(document.markdown),
    mediaType: MARKDOWN_MEDIA_TYPE,
    assets: [],
  });
  if (persisted.skipped) return { phaseComplete: false };
  metaSet(ctx.sql, "website_finalized", "1");
  return { phaseComplete: ctx.budget.canSpend(ARCHIVE_MISSING_SUBREQUESTS + 2) };
}
