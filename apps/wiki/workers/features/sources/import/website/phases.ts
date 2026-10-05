import { and, eq } from "drizzle-orm";
import * as schema from "../../../../../app/db/schema";
import { HTML_MEDIA_TYPE, pathForMediaType } from "../../media-type";
import { persistSourceDocument } from "../../persist";
import { fetchWebsiteSource } from "../../website";
import { MAX_STYLESHEETS } from "../../website-html";
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

type StagedWebsiteDocument = {
  path: string;
  title: string;
  html: string;
  assets: Array<{
    path: string;
    r2Key: string;
    mimeType: string;
    byteSize: number;
    contentHash: string;
  }>;
};

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
    const path = pathForMediaType(document.path, HTML_MEDIA_TYPE);
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
  // HTML fetch + (stylesheet fetch + R2 put) per sheet, capped by MAX_STYLESHEETS.
  const fetchBudget = 1 + MAX_STYLESHEETS * 2;
  if (!ctx.budget.canSpend(fetchBudget)) return { phaseComplete: false };
  ctx.budget.spend(fetchBudget);
  const fetched = await fetchWebsiteSource(ctx.env, current.source.id, current.source.url);
  const staged: StagedWebsiteDocument = {
    path: "index",
    title: fetched.title,
    html: fetched.html,
    assets: fetched.assets,
  };
  metaSet(ctx.sql, WEBSITE_DOCUMENT_KEY, JSON.stringify(staged));
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
  const document = JSON.parse(stored) as StagedWebsiteDocument;
  ctx.budget.spend(PERSIST_REPLACE_SUBREQUESTS);
  const persisted = await persistSourceDocument(ctx.env, {
    sourceId: current.source.id,
    fetchAttemptId: current.run.fetchAttemptId,
    path: pathForMediaType(document.path, HTML_MEDIA_TYPE),
    title: document.title,
    body: new TextEncoder().encode(document.html),
    mediaType: HTML_MEDIA_TYPE,
    assets: document.assets,
  });
  if (persisted.skipped) return { phaseComplete: false };
  metaSet(ctx.sql, "website_finalized", "1");
  return { phaseComplete: ctx.budget.canSpend(ARCHIVE_MISSING_SUBREQUESTS + 2) };
}
