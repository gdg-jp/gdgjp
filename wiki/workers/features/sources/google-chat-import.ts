import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "../../../app/db/schema";
import { getDb } from "../../../app/lib/db.server";
import { getGoogleDriveTokenRow } from "../../../app/lib/google-drive-token.server";
import { hasRequiredGoogleChatScopes } from "../../../app/lib/google-drive.server";
import type { GoogleChatImportQueueBody } from "../../../app/lib/queue-processors.server";
import { type ResolvedSourceAsset, assetR2Key } from "./assets";
import {
  type ChatMessage,
  type ChatMessageAttachment,
  GOOGLE_CHAT_REAUTH_MESSAGE,
  defaultSenderName,
  monthPathFromCreateTime,
  normalizeChatMessages,
} from "./google-chat";
import { archiveMissingDocuments } from "./google-chat-import-private";
import { persistSourceDocument, sha256Hex } from "./persist";

const CHAT_PAGE_SIZE = 10;
const CHAT_TIMEOUT_MS = 30_000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function log(event: string, details: Record<string, string | number>): void {
  console.log(
    JSON.stringify({ component: "sources", integration: "google-chat", event, ...details }),
  );
}

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function currentRun(env: Env, runId: string) {
  const db = getDb(env);
  const run = await db
    .select()
    .from(schema.googleChatImportRuns)
    .where(eq(schema.googleChatImportRuns.id, runId))
    .get();
  if (!run) return null;
  const source = await db
    .select()
    .from(schema.sources)
    .where(
      and(
        eq(schema.sources.id, run.sourceId),
        eq(schema.sources.fetchAttemptId, run.fetchAttemptId),
        eq(schema.sources.status, "fetching"),
      ),
    )
    .get();
  return source ? { db, run, source } : null;
}

async function accessToken(env: Env, source: typeof schema.sources.$inferSelect): Promise<string> {
  const token = await getGoogleDriveTokenRow(env, getDb(env), source.addedBy);
  if (!hasRequiredGoogleChatScopes(token.grantedScopes))
    throw new Error(GOOGLE_CHAT_REAUTH_MESSAGE);
  return token.accessToken;
}

/** Starts a run; all subsequent deliveries are bounded units of work. */
export async function startGoogleChatImport(
  env: Env,
  source: typeof schema.sources.$inferSelect,
  fetchAttemptId: string,
): Promise<boolean> {
  const db = getDb(env);
  const id = nanoid();
  // Claim the source and create its durable run in one transaction. A Queue retry
  // must never observe status="fetching" without the matching run. Replacing a
  // refresh deletes the old run so its child work is removed by the FK cascade.
  await db.batch([
    db
      .update(schema.sources)
      .set({
        status: "fetching",
        fetchAttemptId,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.sources.id, source.id), ne(schema.sources.status, "archived"))),
    db
      .delete(schema.googleChatImportRuns)
      .where(eq(schema.googleChatImportRuns.sourceId, source.id)),
    db.insert(schema.googleChatImportRuns).values({ id, sourceId: source.id, fetchAttemptId }),
  ]);
  const current = await currentRun(env, id);
  if (!current) {
    await db.delete(schema.googleChatImportRuns).where(eq(schema.googleChatImportRuns.id, id));
    return false;
  }
  // Validate access only after the durable lease exists. If this throws, fetchSource
  // records the source error; a later refresh atomically replaces this run.
  await accessToken(env, current.source);
  await env.SOURCE_FETCH_QUEUE.send({ type: "google_chat_import", runId: id, work: "list" });
  log("import_started", { sourceId: source.id, runId: id, subrequestsBudget: 10 });
  return true;
}

export async function processGoogleChatImport(
  env: Env,
  work: GoogleChatImportQueueBody,
): Promise<void> {
  try {
    if (work.work === "list") return await listPage(env, work.runId);
    if (work.work === "message") return await processMessage(env, work.runId, work.messageId);
    return await finalizeMonth(env, work.runId, work.monthIndex);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await getDb(env)
      .update(schema.googleChatImportRuns)
      .set({ errorMessage: message.slice(0, 2000), updatedAt: new Date() })
      .where(eq(schema.googleChatImportRuns.id, work.runId));
    log("work_failed", { runId: work.runId, work: work.work, subrequestsBudget: 10 });
    throw error;
  }
}

async function listPage(env: Env, runId: string): Promise<void> {
  const current = await currentRun(env, runId);
  if (!current || current.run.phase !== "listing") return;
  const token = await accessToken(env, current.source);
  const spaceName = current.source.externalId?.startsWith("spaces/")
    ? current.source.externalId
    : `spaces/${current.source.externalId}`;
  const params = new URLSearchParams({ pageSize: String(CHAT_PAGE_SIZE) });
  if (current.run.nextPageToken) params.set("pageToken", current.run.nextPageToken);
  const response = await fetchWithTimeout(
    `https://chat.googleapis.com/v1/${spaceName}/messages?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`Google Chat messages.list failed (${response.status})`);
  const page = (await response.json()) as { messages?: ChatMessage[]; nextPageToken?: string };
  const messages = page.messages ?? [];
  const base = current.run.messagesFetched;
  const messageIds: string[] = [];
  for (const [index, message] of messages.entries()) {
    const messageName = message.name || `unnamed-${base + index}`;
    const id = nanoid();
    const r2Key = `raw/${current.source.id}/chat-runs/${runId}/messages/${base + index}.json`;
    const messageJson = JSON.stringify(message);
    await env.BUCKET.put(r2Key, messageJson, { httpMetadata: { contentType: "application/json" } });
    await current.db
      .insert(schema.googleChatImportMessages)
      .values({
        id,
        runId,
        messageName,
        sequence: base + index,
        monthPath: message.createTime ? monthPathFromCreateTime(message.createTime) : null,
        messageR2Key: r2Key,
        messageJson,
      })
      .onConflictDoNothing();
    messageIds.push(id);
  }
  const nextToken = page.nextPageToken ?? null;
  await current.db
    .update(schema.googleChatImportRuns)
    .set({
      nextPageToken: nextToken,
      phase: nextToken ? "listing" : "finalizing",
      pagesFetched: current.run.pagesFetched + 1,
      messagesFetched: current.run.messagesFetched + messages.length,
      updatedAt: new Date(),
    })
    .where(eq(schema.googleChatImportRuns.id, runId));
  for (const messageId of messageIds) {
    await env.SOURCE_FETCH_QUEUE.send({
      type: "google_chat_import",
      runId,
      work: "message",
      messageId,
    });
  }
  if (nextToken)
    await env.SOURCE_FETCH_QUEUE.send({ type: "google_chat_import", runId, work: "list" });
  else await maybeEnqueueFinalize(env, runId);
  log("page_stored", {
    sourceId: current.source.id,
    runId,
    messages: messages.length,
    subrequestsBudget: 10,
  });
}

function attachmentObjectId(attachment: ChatMessageAttachment, index: number): string {
  return (
    attachment.name?.split("/").pop() ||
    attachment.driveDataRef?.driveFileId ||
    attachment.attachmentDataRef?.resourceName?.replace(/\//g, "_") ||
    `attachment-${index}`
  );
}

async function processMessage(env: Env, runId: string, messageId: string): Promise<void> {
  const current = await currentRun(env, runId);
  if (!current) return;
  const row = await current.db
    .select()
    .from(schema.googleChatImportMessages)
    .where(
      and(
        eq(schema.googleChatImportMessages.id, messageId),
        eq(schema.googleChatImportMessages.runId, runId),
      ),
    )
    .get();
  if (!row || row.status === "ready") return;
  const message = JSON.parse(row.messageJson) as ChatMessage;
  const token = await accessToken(env, current.source);
  if (row.senderName === null) {
    const sender = message.sender;
    let senderName = defaultSenderName(sender);
    if (sender?.name && sender.type !== "BOT") {
      const peopleName = sender.name.startsWith("users/")
        ? sender.name.replace(/^users\//, "people/")
        : sender.name;
      const response = await fetchWithTimeout(
        `https://people.googleapis.com/v1/${peopleName}?personFields=names&sources=READ_SOURCE_TYPE_PROFILE`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (response.ok) {
        const person = (await response.json()) as { names?: Array<{ displayName?: string }> };
        senderName = person.names?.[0]?.displayName?.trim() || senderName;
      }
    }
    await current.db
      .update(schema.googleChatImportMessages)
      .set({ senderName, status: "processing" })
      .where(eq(schema.googleChatImportMessages.id, messageId));
    await env.SOURCE_FETCH_QUEUE.send({
      type: "google_chat_import",
      runId,
      work: "message",
      messageId,
    });
    return;
  }

  const attachments = message.attachment ?? [];
  if (row.attachmentIndex < attachments.length) {
    const index = row.attachmentIndex;
    const attachment = attachments[index];
    if (attachment) {
      const asset = await downloadAttachment(
        env,
        current.source.id,
        token,
        attachmentObjectId(attachment, index),
        attachment,
      );
      const assets = JSON.parse(row.assetsJson) as Array<{
        objectId: string;
        asset: ResolvedSourceAsset;
      }>;
      if (asset) assets.push({ objectId: attachmentObjectId(attachment, index), asset });
      await current.db
        .update(schema.googleChatImportMessages)
        .set({ attachmentIndex: index + 1, assetsJson: JSON.stringify(assets) })
        .where(eq(schema.googleChatImportMessages.id, messageId));
    }
    await env.SOURCE_FETCH_QUEUE.send({
      type: "google_chat_import",
      runId,
      work: "message",
      messageId,
    });
    return;
  }
  await current.db
    .update(schema.googleChatImportMessages)
    .set({ status: "ready" })
    .where(eq(schema.googleChatImportMessages.id, messageId));
  await maybeEnqueueFinalize(env, runId);
}

async function downloadAttachment(
  env: Env,
  sourceId: string,
  token: string,
  objectId: string,
  attachment: ChatMessageAttachment,
): Promise<ResolvedSourceAsset | null> {
  const driveId = attachment.driveDataRef?.driveFileId;
  const media = attachment.attachmentDataRef?.resourceName;
  if (!driveId && !media) return null;
  const url = driveId
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`
    : `https://chat.googleapis.com/v1/media/${media}?alt=media`;
  const response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 403 || response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Unable to download a Google Chat attachment (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES)
    throw new Error("A Google Chat attachment exceeds the 10 MB limit");
  const mimeType =
    response.headers.get("Content-Type")?.split(";")[0] ||
    attachment.contentType ||
    "application/octet-stream";
  const contentHash = await sha256Hex(bytes);
  const r2Key = assetR2Key(sourceId, objectId, contentHash, mimeType);
  await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: mimeType } });
  return { path: r2Key, r2Key, mimeType, byteSize: bytes.byteLength, contentHash };
}

async function maybeEnqueueFinalize(env: Env, runId: string): Promise<void> {
  const current = await currentRun(env, runId);
  if (!current || current.run.phase !== "finalizing") return;
  const pending = await current.db
    .select({ id: schema.googleChatImportMessages.id })
    .from(schema.googleChatImportMessages)
    .where(
      and(
        eq(schema.googleChatImportMessages.runId, runId),
        eq(schema.googleChatImportMessages.status, "pending"),
      ),
    )
    .get();
  const processing = await current.db
    .select({ id: schema.googleChatImportMessages.id })
    .from(schema.googleChatImportMessages)
    .where(
      and(
        eq(schema.googleChatImportMessages.runId, runId),
        eq(schema.googleChatImportMessages.status, "processing"),
      ),
    )
    .get();
  if (!pending && !processing)
    await env.SOURCE_FETCH_QUEUE.send({
      type: "google_chat_import",
      runId,
      work: "finalize",
      monthIndex: 0,
    });
}

async function finalizeMonth(env: Env, runId: string, monthIndex: number): Promise<void> {
  const current = await currentRun(env, runId);
  if (!current || current.run.phase !== "finalizing") return;
  const rows = await current.db
    .select()
    .from(schema.googleChatImportMessages)
    .where(eq(schema.googleChatImportMessages.runId, runId))
    .all();
  if (rows.some((row) => row.status !== "ready")) return;
  const messages = rows.map((row) => JSON.parse(row.messageJson) as ChatMessage);
  const names = new Map<string, string>();
  const parents = new Map<string, string>();
  for (const [index, message] of messages.entries()) {
    const senderName = rows[index]?.senderName;
    if (message.sender?.name && senderName) names.set(message.sender.name, senderName);
    if (!message.threadReply && message.thread?.name && message.text?.trim())
      parents.set(message.thread.name, message.text);
  }
  const months = normalizeChatMessages(messages, {
    resolveSenderName: (sender) =>
      sender?.name
        ? names.get(sender.name) || defaultSenderName(sender)
        : defaultSenderName(sender),
    threadParents: parents,
  });
  const month = months[monthIndex];
  if (month) {
    const assets = rows
      .filter((row) => row.monthPath === month.path)
      .flatMap(
        (row) =>
          JSON.parse(row.assetsJson) as Array<{ objectId: string; asset: ResolvedSourceAsset }>,
      );
    let markdown = month.markdown;
    for (const { objectId, asset } of assets)
      markdown = markdown.replaceAll(`attachment:${objectId}`, asset.path);
    await persistSourceDocument(env, {
      sourceId: current.source.id,
      fetchAttemptId: current.run.fetchAttemptId,
      path: month.path,
      title: month.title,
      markdown,
      cursor: month.cursor,
      metadata: JSON.stringify({ urls: month.urls }),
      assets: assets.map(({ asset }) => asset),
      assetPolicy: "replace",
    });
    await env.SOURCE_FETCH_QUEUE.send({
      type: "google_chat_import",
      runId,
      work: "finalize",
      monthIndex: monthIndex + 1,
    });
    return;
  }
  await archiveMissingDocuments(
    current.db,
    current.source.id,
    current.run.fetchAttemptId,
    months.map((month) => month.path),
  );
  await current.db
    .update(schema.sources)
    .set({
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
      ),
    );
  await current.db
    .update(schema.googleChatImportRuns)
    .set({ phase: "complete", updatedAt: new Date() })
    .where(eq(schema.googleChatImportRuns.id, runId));
  log("import_completed", {
    sourceId: current.source.id,
    runId,
    pages: current.run.pagesFetched,
    messages: current.run.messagesFetched,
    subrequestsBudget: 10,
  });
}
