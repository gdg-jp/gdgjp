import { desc, eq, inArray, ne } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { AccessIdentity, AuthUser } from "~/features/auth/utils.server";
import { getAccessIdentity, requireUser } from "~/features/auth/utils.server";
import {
  canAccessSource,
  createSource,
  deleteArchivedSource,
  enqueueSourceRefresh,
  unarchiveSource,
  updateSourceVisibility,
} from "~/features/sources/sources.server";
import { parseBatchCandidates } from "~/features/sources/staged-candidates";
import { loadChapterDirectory } from "~/lib/chapter-directory.server";
import { getDb } from "~/lib/db.server";
import {
  isChatSenderResourceName,
  saveChatSenderName,
} from "../../../workers/features/sources/chat-sender-registry";

/** Data assembly behind the `/sources` loader — see `app/routes/sources/page.tsx`. */
export async function loadSourcesPageData(request: Request, env: Env) {
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const sourcesData = (async () => {
    const rows = await db
      .select()
      .from(schema.sources)
      .where(ne(schema.sources.kind, "conversation"))
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

    // Chapter labels come from Accounts (same directory ShareDialog uses). Wiki's
    // local `chapters` table is not kept in sync with memberships, so reading it
    // left the picker empty and Radix Select appeared not to open.
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
    // Only chapters the user may actually assign, so the picker cannot offer a scope
    // the action would reject.
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
    // Profiles are one row per sender — select all instead of an unbounded inArray.
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
      sources: visible.map((source) => ({
        ...source,
        documents: documentsBySource.get(source.id) ?? [],
      })),
    };
  })();

  return {
    currentUserId: user.id,
    isAdmin: user.isAdmin,
    sourcesData,
  };
}

/** Intent dispatch behind the `/sources` action — see `app/routes/sources/page.tsx`. */
export async function handleSourcesAction(
  env: Env,
  form: FormData,
  user: AuthUser,
  identity: AccessIdentity,
) {
  const intent = String(form.get("intent") ?? "create");

  if (intent === "create-batch") {
    const candidates = parseBatchCandidates(form.get("candidates"));
    if (!candidates) return { ok: false as const, error: "invalid_batch" };

    const addedIds: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    for (const candidate of candidates) {
      const result = await createSource(env, {
        ...(candidate.kind === "google-chat-space"
          ? { kind: candidate.kind, externalId: candidate.externalId }
          : candidate.kind === "discord-channel"
            ? {
                kind: candidate.kind,
                externalId: candidate.externalId,
                url: candidate.url,
              }
            : { url: candidate.url }),
        title: candidate.title,
        visibility: form.get("visibility"),
        chapter: form.get("chapter"),
        refreshPolicy: form.get("refreshPolicy"),
        user,
        chapters: identity.chapters,
      });

      // `createSource` persists an error source when queue delivery fails. It must leave
      // the staging list so retrying cannot create a duplicate source.
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
