import { getBearerIdentity } from "@gdgjp/gdg-lib";
import { eq } from "drizzle-orm";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getAgentInstructions } from "~/features/agent-api/agents-md.server";
import { canonicalMarkdown } from "~/features/editor/content-format";
import { getEffectivePagePermissions } from "~/features/pages/access.server";
import { removeAclSpans } from "~/features/pages/acl-spans";
import { pageAclClearance } from "~/features/pages/acl-spans.server";
import { getDb } from "~/lib/db.server";
import type { components } from "../../../../openapi/types.generated";

type WikiSnapshot = components["schemas"]["Snapshot"];
type WikiSnapshotPage = components["schemas"]["SnapshotPage"];

/**
 * Snapshot is an external contract: retain this normalization while old rows
 * may exist during a rolling migration, even though persisted content is Markdown.
 */
export function snapshotContentAsMarkdown(content: string): string {
  return canonicalMarkdown(content);
}

/** GET /api/cli/wiki/snapshot -- agent pages visible to the CLI token. */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await getBearerIdentity(request, env.ACCOUNTS_URL);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });
  const db = getDb(env);
  const langParam = new URL(request.url).searchParams.get("lang");
  if (langParam !== null && langParam !== "ja" && langParam !== "en")
    return Response.json({ error: "invalid_lang" }, { status: 400 });
  const locale = langParam === "en" ? "en" : "ja";
  const [pages, tags, access, sources, attachments, agents] = await Promise.all([
    db.select().from(schema.pages).all(),
    db.select().from(schema.pageTags).all(),
    db.select().from(schema.pageAccess).all(),
    db.select().from(schema.pageSources).all(),
    db.select().from(schema.pageAttachments).all(),
    getAgentInstructions(db),
  ]);
  const visible: WikiSnapshotPage[] = [];
  for (const page of pages) {
    if (page.status === "archived" || page.pageType === "task-list" || page.origin !== "agent")
      continue;
    const permissions = await getEffectivePagePermissions(
      db,
      page,
      identity.user,
      identity.chapters,
    );
    if (!permissions.canView) continue;

    const fullClearance = await pageAclClearance(
      db,
      [page.contentJa, page.contentEn],
      identity.user,
      identity.chapters,
    );
    const contentJa = snapshotContentAsMarkdown(page.contentJa);
    const contentEn = snapshotContentAsMarkdown(page.contentEn);

    visible.push({
      id: page.id,
      slug: page.slug,
      parentId: page.parentId,
      sortOrder: page.sortOrder,
      revision: page.syncRevision,
      ...(locale === "ja" && {
        ja: {
          title: page.titleJa,
          summary: page.summaryJa,
          translationStatus: page.translationStatusJa,
          content: fullClearance ? contentJa : removeAclSpans(contentJa),
        },
      }),
      ...(locale === "en" && {
        en: {
          title: page.titleEn,
          summary: page.summaryEn,
          translationStatus: page.translationStatusEn,
          content: fullClearance ? contentEn : removeAclSpans(contentEn),
        },
      }),
      pageType: page.pageType,
      pageMetadata: page.pageMetadata ? JSON.parse(page.pageMetadata) : null,
      visibility: page.visibility,
      generalRole: page.generalRole,
      chapterId: page.chapterId,
      aclRedacted: !fullClearance,
      tags: tags.filter((row) => row.pageId === page.id).map((row) => row.tagSlug),
      access: access
        .filter((row) => row.pageId === page.id)
        .map(({ id, subjectType, subjectKey, subjectLabel, role }) => ({
          id,
          subjectType,
          subjectKey,
          subjectLabel,
          role,
        })),
      sources: sources
        .filter((row) => row.pageId === page.id)
        .map(({ id, url, title, sourceId }) => ({ id, url, title, sourceId })),
      attachments: attachments
        .filter((row) => row.pageId === page.id)
        .map(({ id, r2Key, fileName, mimeType }) => ({
          id,
          r2Key,
          fileName,
          mimeType,
          downloadUrl: `/api/cli/wiki/attachments/${id}`,
        })),
    } as WikiSnapshotPage);
  }
  if (!agents) return Response.json({ error: "agents_md_unavailable" }, { status: 503 });
  const snapshot: WikiSnapshot = { version: 1, pages: visible, agentsMd: agents };
  return Response.json(snapshot);
}
