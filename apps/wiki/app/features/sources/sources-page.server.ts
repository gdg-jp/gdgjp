import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { AccessIdentity, AuthUser } from "~/features/auth/utils.server";
import { requireUser } from "~/features/auth/utils.server";
import { integrateNow } from "~/features/jobs/enqueue.server";
import { REGISTRATIONS } from "~/features/sources/kinds";
import {
  canAccessSource,
  createSource,
  deleteArchivedSource,
  enqueueSourceRefresh,
  unarchiveSource,
  updateSourceVisibility,
} from "~/features/sources/sources.server";
import { parseBatchCandidates } from "~/features/sources/staged-candidates";
import { requireSpace } from "~/features/spaces/access.server";
import { loadChapterDirectory } from "~/lib/chapter-directory.server";
import { getDb } from "~/lib/db.server";
import {
  isChatSenderResourceName,
  saveChatSenderName,
} from "../../../workers/features/sources/chat-sender-registry";

export async function loadSourcesPageData(
  request: Request,
  env: Env,
  spaceSlug: string | undefined,
) {
  const user = await requireUser(request, env);
  const { space, role, identity } = await requireSpace(request, env, spaceSlug);
  const db = getDb(env);

  const sourcesData = (async () => {
    const rows = await db
      .select()
      .from(schema.sources)
      .where(and(eq(schema.sources.spaceId, space.id), ne(schema.sources.kind, "conversation")))
      .orderBy(desc(schema.sources.createdAt))
      .all();

    const visible = rows.filter((row) => canAccessSource(row, user, identity.chapters));
    const sourceIds = visible.map((row) => row.id);

    const documents =
      sourceIds.length === 0
        ? []
        : await db
            .select({
              id: schema.sourceDocuments.id,
              sourceId: schema.sourceDocuments.sourceId,
              path: schema.sourceDocuments.path,
              title: schema.sourceDocuments.title,
              contentHash: schema.sourceDocuments.contentHash,
              mediaType: schema.sourceDocuments.mediaType,
              capturedAt: schema.sourceDocuments.capturedAt,
              status: schema.sourceDocuments.status,
              integratedHash: schema.sourceDocuments.integratedHash,
            })
            .from(schema.sourceDocuments)
            .where(inArray(schema.sourceDocuments.sourceId, sourceIds))
            .orderBy(schema.sourceDocuments.path)
            .all();

    const documentsBySource = new Map<string, typeof documents>();
    for (const doc of documents) {
      const list = documentsBySource.get(doc.sourceId) ?? [];
      list.push(doc);
      documentsBySource.set(doc.sourceId, list);
    }

    const directoryChapters = await loadChapterDirectory(env).catch((error) => {
      console.error("[sources] unable to load chapter directory", error);
      return [];
    });
    const localChapters = await db
      .select({
        id: schema.chapters.id,
        nameJa: schema.chapters.nameJa,
        nameEn: schema.chapters.nameEn,
      })
      .from(schema.chapters)
      .orderBy(schema.chapters.nameJa)
      .all();

    const chapterById = new Map<string, { id: string; nameJa: string; nameEn: string }>();
    for (const chapter of localChapters) {
      chapterById.set(chapter.id, chapter);
    }
    for (const chapter of directoryChapters) {
      chapterById.set(chapter.id, {
        id: chapter.id,
        nameJa: chapter.name,
        nameEn: chapter.name,
      });
    }
    for (const membership of identity.chapters) {
      const id = String(membership.chapterId);
      if (chapterById.has(id)) continue;
      const label = membership.chapterSlug || id;
      chapterById.set(id, { id, nameJa: label, nameEn: label });
    }

    const allChapters = [...chapterById.values()].sort((a, b) =>
      a.nameJa.localeCompare(b.nameJa, "ja"),
    );
    const assignableChapters = user.isAdmin
      ? allChapters
      : identity.chapterIds
          .map((id) => chapterById.get(id))
          .filter((chapter): chapter is { id: string; nameJa: string; nameEn: string } =>
            Boolean(chapter),
          )
          .sort((a, b) => a.nameJa.localeCompare(b.nameJa, "ja"));

    const senderSamples = await db
      .select({
        resourceName: schema.googleChatSenderSamples.resourceName,
        messageText: schema.googleChatSenderSamples.messageText,
        createdAt: schema.googleChatSenderSamples.createdAt,
        sourceId: schema.googleChatSenderSamples.sourceId,
        sourceTitle: schema.sources.title,
      })
      .from(schema.googleChatSenderSamples)
      .innerJoin(schema.sources, eq(schema.googleChatSenderSamples.sourceId, schema.sources.id))
      .orderBy(desc(schema.googleChatSenderSamples.createdAt))
      .all();
    const visibleSamples = senderSamples.filter((sample) => {
      const source = visible.find((item) => item.id === sample.sourceId);
      return source !== undefined;
    });
    const profiles = await db
      .select({
        resourceName: schema.googleChatSenderProfiles.resourceName,
        displayName: schema.googleChatSenderProfiles.displayName,
      })
      .from(schema.googleChatSenderProfiles)
      .all();

    return {
      allChapters,
      assignableChapters,
      chatSenders: {
        profiles,
        samples: visibleSamples,
      },
      sources: visible.map((source) => {
        const docs = documentsBySource.get(source.id) ?? [];
        return {
          ...source,
          documents: docs,
          pendingIntegration: docs.filter(
            (doc) => doc.status === "ready" && doc.integratedHash !== doc.contentHash,
          ).length,
        };
      }),
      integration: await loadIntegrationSummary(db, space.id),
    };
  })();

  return {
    currentUserId: user.id,
    isAdmin: user.isAdmin,
    space: { id: space.id, slug: space.slug, name: space.name },
    canEditSpace: role === "owner" || role === "editor",
    sourcesData,
  };
}

export async function handleSourcesAction(
  env: Env,
  form: FormData,
  user: AuthUser,
  identity: AccessIdentity,
  space: { id: string },
) {
  const intent = String(form.get("intent") ?? "create");
  const namedSourceId = form.get("sourceId");
  if (typeof namedSourceId === "string" && namedSourceId) {
    const owner = await getDb(env)
      .select({ spaceId: schema.sources.spaceId })
      .from(schema.sources)
      .where(eq(schema.sources.id, namedSourceId))
      .get();
    if (!owner || owner.spaceId !== space.id) return { ok: false as const, error: "not_found" };
  }

  if (intent === "create-batch") {
    const candidates = parseBatchCandidates(form.get("candidates"));
    if (!candidates) return { ok: false as const, error: "invalid_batch" };

    const addedIds: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    for (const candidate of candidates) {
      const result = await createSource(env, {
        spaceId: space.id,
        ...REGISTRATIONS[candidate.kind].toCreateInput(candidate),
        visibility: form.get("visibility"),
        chapter: form.get("chapter"),
        refreshPolicy: form.get("refreshPolicy"),
        user,
        chapters: identity.chapters,
      });

      if (result.ok || result.error === "enqueue_failed") {
        addedIds.push(candidate.id);
      } else {
        failed.push({ id: candidate.id, error: result.error });
      }
    }
    return { ok: true as const, addedIds, failed };
  }

  if (intent === "create") {
    const result = await createSource(env, {
      spaceId: space.id,
      url: form.get("url"),
      title: form.get("title"),
      visibility: form.get("visibility"),
      chapter: form.get("chapter"),
      refreshPolicy: form.get("refreshPolicy"),
      user,
      chapters: identity.chapters,
    });
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
  }

  if (intent === "create-chat-space") {
    const result = await createSource(env, {
      spaceId: space.id,
      kind: "google-chat-space",
      externalId: form.get("externalId"),
      title: form.get("title"),
      visibility: form.get("visibility"),
      chapter: form.get("chapter"),
      refreshPolicy: form.get("refreshPolicy"),
      user,
      chapters: identity.chapters,
    });
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
  }

  if (intent === "save-chat-sender") {
    const resourceName = String(form.get("senderId") ?? "").trim();
    const displayName = String(form.get("displayName") ?? "").trim();
    if (!isChatSenderResourceName(resourceName))
      return { ok: false as const, error: "invalid_sender" };
    if (!displayName || displayName.length > 120) {
      return { ok: false as const, error: "sender_name_required" };
    }
    const db = getDb(env);
    const known = await db
      .select({ source: schema.sources })
      .from(schema.googleChatSenderSamples)
      .innerJoin(schema.sources, eq(schema.googleChatSenderSamples.sourceId, schema.sources.id))
      .where(eq(schema.googleChatSenderSamples.resourceName, resourceName))
      .all();
    if (!known.some(({ source }) => canAccessSource(source, user, identity.chapters))) {
      return { ok: false as const, error: "invalid_sender" };
    }
    await saveChatSenderName(env, resourceName, displayName);
    return { ok: true as const, senderSaved: true };
  }

  if (intent === "integrate-now") {
    await integrateNow(getDb(env), space.id);
    return { ok: true as const };
  }

  if (intent === "update-visibility") {
    const sourceId = String(form.get("sourceId") ?? "");
    const result = await updateSourceVisibility(env, sourceId, {
      visibility: form.get("visibility"),
      chapter: form.get("chapter"),
      user,
      chapters: identity.chapters,
    });
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
  }

  if (
    intent === "refresh" ||
    intent === "archive" ||
    intent === "unarchive" ||
    intent === "delete"
  ) {
    const sourceId = String(form.get("sourceId") ?? "");
    const db = getDb(env);
    const source = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, sourceId))
      .get();
    if (!source || !canAccessSource(source, user, identity.chapters)) {
      return { ok: false as const, error: "not_found" };
    }

    if (intent === "archive") {
      await db
        .update(schema.sources)
        .set({ status: "archived", fetchAttemptId: null, updatedAt: new Date() })
        .where(eq(schema.sources.id, sourceId));
      return { ok: true as const };
    }

    if (intent === "unarchive") {
      const result = await unarchiveSource(env, sourceId);
      return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
    }

    if (intent === "delete") {
      const result = await deleteArchivedSource(env, sourceId);
      return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
    }

    if (source.status === "archived") {
      return { ok: false as const, error: "archived" };
    }
    const result = await enqueueSourceRefresh(env, sourceId);
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
  }

  return { ok: false as const, error: "unknown_intent" };
}

async function loadIntegrationSummary(db: ReturnType<typeof getDb>, spaceId: string) {
  const rows = await db
    .select({
      status: schema.agentJobs.status,
      count: sql<number>`count(*)`,
      oldest: sql<number | null>`min(${schema.agentJobs.createdAt})`,
    })
    .from(schema.agentJobs)
    .where(
      and(
        eq(schema.agentJobs.spaceId, spaceId),
        eq(schema.agentJobs.type, "synthesize"),
        inArray(schema.agentJobs.status, ["queued", "leased"]),
      ),
    )
    .groupBy(schema.agentJobs.status)
    .all();
  const queued = rows.find((row) => row.status === "queued");
  const leased = rows.find((row) => row.status === "leased");
  const oldest = Math.min(...rows.map((row) => row.oldest ?? Number.POSITIVE_INFINITY));
  return {
    queued: queued?.count ?? 0,
    leased: leased?.count ?? 0,
    oldestQueuedAt: Number.isFinite(oldest) ? oldest * 1000 : null,
  };
}
