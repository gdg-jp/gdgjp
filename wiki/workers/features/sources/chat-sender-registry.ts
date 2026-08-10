import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "../../../app/db/schema";
import { getDb } from "../../../app/lib/db.server";
import type { ChatMessage } from "./google-chat";
import { defaultSenderName, normalizeChatMessages } from "./google-chat";
import { MARKDOWN_MEDIA_TYPE, markdownBody } from "./media-type";
import { contentR2Key, sha256Hex } from "./persist";
import type { SubrequestBudget } from "./subrequest-budget";

const MAX_SENDER_SAMPLES = 10;
const USER_RESOURCE_NAME = /^users\/[A-Za-z0-9_-]+$/;

/** Render upsert (1) + sample insert/prune batch (1). */
export const CAPTURE_CHAT_SENDER_SUBREQUESTS = 2;

export interface ChatDocumentRenderData {
  messages?: ChatMessage[];
  threadParents?: Array<[string, string]>;
  assets?: Array<[string, string]>;
  skippedAttachments?: Array<[string, string]>;
  /** Private original for Markdown imported before render data was introduced. */
  legacyMarkdown?: string;
}

export function isChatSenderResourceName(value: string): boolean {
  return USER_RESOURCE_NAME.test(value);
}

function senderMessageText(message: ChatMessage): string {
  return (message.text ?? message.argumentText ?? "").trim();
}

function pruneSenderSamplesStatement(db: ReturnType<typeof getDb>, resourceName: string) {
  return db.delete(schema.googleChatSenderSamples).where(
    sql`resource_name = ${resourceName}
      AND id NOT IN (
        SELECT id FROM google_chat_sender_samples
        WHERE resource_name = ${resourceName}
        ORDER BY created_at DESC, id DESC
        LIMIT ${sql.raw(String(MAX_SENDER_SAMPLES))}
      )`,
  );
}

/** Save private render data and a bounded set of examples while importing a Chat week. */
export async function captureChatSenderData(
  env: Env,
  input: {
    sourceId: string;
    sourceDocumentId: string;
    messages: readonly ChatMessage[];
    threadParents: ReadonlyMap<string, string>;
    assets: ReadonlyMap<string, { path: string }>;
    skippedAttachments: ReadonlyMap<string, string>;
    configuredSenders: ReadonlySet<string>;
    budget: SubrequestBudget;
  },
): Promise<void> {
  input.budget.spend(CAPTURE_CHAT_SENDER_SUBREQUESTS);

  const db = getDb(env);
  const now = new Date();
  const renderData: ChatDocumentRenderData = {
    messages: [...input.messages],
    threadParents: [...input.threadParents.entries()],
    assets: [...input.assets.entries()].map(([id, asset]) => [id, asset.path]),
    skippedAttachments: [...input.skippedAttachments.entries()],
  };
  await db
    .insert(schema.googleChatDocumentRenders)
    .values({
      sourceDocumentId: input.sourceDocumentId,
      renderData: JSON.stringify(renderData),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.googleChatDocumentRenders.sourceDocumentId,
      set: { renderData: JSON.stringify(renderData), updatedAt: now },
    });

  const latestBySender = new Map<string, ChatMessage[]>();
  for (const message of input.messages) {
    const resourceName = message.sender?.name;
    if (!resourceName || !message.createTime) continue;
    const entries = latestBySender.get(resourceName) ?? [];
    entries.push(message);
    latestBySender.set(resourceName, entries);
  }

  const statements = [];
  for (const [resourceName, messages] of latestBySender) {
    if (input.configuredSenders.has(resourceName)) continue;
    const retained = [...messages]
      .filter((message) => senderMessageText(message).length > 0)
      .sort(
        (a, b) =>
          new Date(b.createTime as string).getTime() - new Date(a.createTime as string).getTime(),
      )
      .slice(0, MAX_SENDER_SAMPLES);
    if (retained.length === 0) continue;

    for (const message of retained) {
      statements.push(
        db
          .insert(schema.googleChatSenderSamples)
          .values({
            id: nanoid(),
            resourceName,
            sourceId: input.sourceId,
            messageName: message.name ?? `${resourceName}:${message.createTime}`,
            messageText: senderMessageText(message),
            createdAt: new Date(message.createTime as string),
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              schema.googleChatSenderSamples.resourceName,
              schema.googleChatSenderSamples.sourceId,
              schema.googleChatSenderSamples.messageName,
            ],
            set: {
              messageText: senderMessageText(message),
              createdAt: new Date(message.createTime as string),
              updatedAt: now,
            },
          }),
      );
    }
    statements.push(pruneSenderSamplesStatement(db, resourceName));
  }

  if (statements.length > 0) {
    await db.batch(statements as [(typeof statements)[0], ...typeof statements]);
  }
}

function renderMarkdown(
  data: ChatDocumentRenderData,
  senderNames: ReadonlyMap<string, string>,
): string | null {
  if (data.legacyMarkdown !== undefined) {
    return data.legacyMarkdown.replace(
      /^### \[[^\]]+\] Unknown user \((users\/[A-Za-z0-9_-]+)\)$/gmu,
      (heading, sender) => senderNames.get(sender) ?? heading,
    );
  }
  if (!data.messages) return null;
  const [normalized] = normalizeChatMessages(data.messages, {
    resolveSenderName: (sender) =>
      (sender?.name ? senderNames.get(sender.name) : undefined) ?? defaultSenderName(sender),
    threadParents: new Map(data.threadParents ?? []),
  });
  if (!normalized) return null;
  const assets = new Map(data.assets ?? []);
  const skipped = new Map(data.skippedAttachments ?? []);
  let markdown = normalized.markdown;
  for (const attachment of normalized.attachments) {
    const assetPath = assets.get(attachment.objectId);
    if (assetPath) {
      markdown = markdown.replaceAll(`attachment:${attachment.objectId}`, assetPath);
    } else if (skipped.has(attachment.objectId)) {
      const name = skipped.get(attachment.objectId) ?? attachment.contentName;
      markdown = markdown
        .replaceAll(`![${name}](attachment:${attachment.objectId})`, "")
        .replaceAll(`[${name}](attachment:${attachment.objectId})`, name);
    }
  }
  return markdown;
}

/** Re-render all affected private Chat document inputs after a name is changed. */
export async function rewriteChatSenderDocuments(env: Env, resourceName: string): Promise<void> {
  const db = getDb(env);
  const profiles = await db.select().from(schema.googleChatSenderProfiles).all();
  const senderNames = new Map(
    profiles.map((profile) => [profile.resourceName, profile.displayName]),
  );
  const records = await db
    .select({ render: schema.googleChatDocumentRenders, document: schema.sourceDocuments })
    .from(schema.googleChatDocumentRenders)
    .innerJoin(
      schema.sourceDocuments,
      eq(schema.googleChatDocumentRenders.sourceDocumentId, schema.sourceDocuments.id),
    )
    .all();
  const renderedDocumentIds = new Set(records.map(({ document }) => document.id));
  for (const { render, document } of records) {
    let data: ChatDocumentRenderData;
    try {
      data = JSON.parse(render.renderData) as ChatDocumentRenderData;
    } catch {
      continue;
    }
    if (!data.messages?.some((message) => message.sender?.name === resourceName)) continue;
    const markdown = renderMarkdown(data, senderNames);
    if (markdown === null) continue;
    const body = markdownBody(markdown);
    const contentHash = await sha256Hex(body);
    if (contentHash === document.contentHash) continue;
    const r2Key = contentR2Key(document.sourceId, document.id, contentHash, MARKDOWN_MEDIA_TYPE);
    await env.BUCKET.put(r2Key, body, {
      httpMetadata: { contentType: `${MARKDOWN_MEDIA_TYPE}; charset=utf-8` },
      customMetadata: { sha256: contentHash, path: document.path },
    });
    await db
      .update(schema.sourceDocuments)
      .set({ r2Key, contentHash, capturedAt: new Date(), mediaType: MARKDOWN_MEDIA_TYPE })
      .where(eq(schema.sourceDocuments.id, document.id));
  }

  const legacyDocuments = await db
    .select({ document: schema.sourceDocuments })
    .from(schema.sourceDocuments)
    .innerJoin(schema.sources, eq(schema.sourceDocuments.sourceId, schema.sources.id))
    .where(eq(schema.sources.kind, "google-chat-space"))
    .all();
  for (const { document } of legacyDocuments) {
    if (renderedDocumentIds.has(document.id) || document.status !== "ready") continue;
    const object = await env.BUCKET.get(document.r2Key);
    if (!object) continue;
    const legacyMarkdown = await object.text();
    if (!legacyMarkdown.includes(`Unknown user (${resourceName})`)) continue;
    const renderData: ChatDocumentRenderData = { legacyMarkdown };
    await db.insert(schema.googleChatDocumentRenders).values({
      sourceDocumentId: document.id,
      renderData: JSON.stringify(renderData),
      updatedAt: new Date(),
    });
    const markdown = renderMarkdown(renderData, senderNames);
    if (!markdown) continue;
    const body = markdownBody(markdown);
    const contentHash = await sha256Hex(body);
    const r2Key = contentR2Key(document.sourceId, document.id, contentHash, MARKDOWN_MEDIA_TYPE);
    await env.BUCKET.put(r2Key, body, {
      httpMetadata: { contentType: `${MARKDOWN_MEDIA_TYPE}; charset=utf-8` },
      customMetadata: { sha256: contentHash, path: document.path },
    });
    await db
      .update(schema.sourceDocuments)
      .set({ r2Key, contentHash, capturedAt: new Date(), mediaType: MARKDOWN_MEDIA_TYPE })
      .where(eq(schema.sourceDocuments.id, document.id));
  }
}

export async function saveChatSenderName(
  env: Env,
  resourceName: string,
  displayName: string,
): Promise<void> {
  const db = getDb(env);
  const now = new Date();
  await db
    .insert(schema.googleChatSenderProfiles)
    .values({ resourceName, displayName, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.googleChatSenderProfiles.resourceName,
      set: { displayName, updatedAt: now },
    });
  await rewriteChatSenderDocuments(env, resourceName);
}
