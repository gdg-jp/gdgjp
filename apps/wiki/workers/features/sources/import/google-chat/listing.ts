import {
  type ChatMessage,
  logGoogleChatMessagesListError,
  weekBoundsRfc3339,
  weekPathFromCreateTime,
} from "../../google-chat";
import { resolveOpenDocument } from "../open-document";
import { metaGet, metaSet } from "../run";
import {
  CHAT_PAGE_SIZE,
  type ChatImportTickContext,
  type Current,
  type StepOutcome,
  fetchWithTimeout,
  indexMessage,
  log,
  requireAccessToken,
  spaceNameOf,
} from "./shared";

export async function stepListing(
  ctx: ChatImportTickContext,
  current: Current,
): Promise<StepOutcome> {
  if (metaGet(ctx.sql, "listing_complete") === "1") return { phaseComplete: true };

  const token = requireAccessToken(ctx);
  // fetch + R2 put; page cursors live in object-local SQLite meta.
  while (ctx.budget.canSpend(2)) {
    const spaceName = spaceNameOf(current.source);
    const params = new URLSearchParams({ pageSize: String(CHAT_PAGE_SIZE) });
    const pageToken = metaGet(ctx.sql, "next_page_token");
    if (pageToken) params.set("pageToken", pageToken);
    if (current.run.sinceCursor) params.set("filter", `createTime > "${current.run.sinceCursor}"`);

    ctx.budget.spend(1);
    const response = await fetchWithTimeout(
      `https://chat.googleapis.com/v1/${spaceName}/messages?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      await logGoogleChatMessagesListError(response, {
        spaceName,
        filter: current.run.sinceCursor ? `createTime > "${current.run.sinceCursor}"` : null,
        hasPageToken: Boolean(pageToken),
      });
      throw new Error(`Google Chat messages.list failed (${response.status})`);
    }
    const page = (await response.json()) as { messages?: ChatMessage[]; nextPageToken?: string };
    const messages = page.messages ?? [];
    const pageIndex = Number(metaGet(ctx.sql, "pages_fetched") ?? "0");
    const r2Key = `raw/${current.source.id}/chat-runs/${ctx.runId}/pages/${pageIndex}.json`;

    ctx.budget.spend(1);
    await ctx.env.BUCKET.put(r2Key, JSON.stringify({ messages }), {
      httpMetadata: { contentType: "application/json" },
    });

    ctx.sql.exec(
      `INSERT INTO pages (page_index, r2_key, message_count) VALUES (?, ?, ?)
       ON CONFLICT(page_index) DO UPDATE SET
         r2_key = excluded.r2_key, message_count = excluded.message_count`,
      pageIndex,
      r2Key,
      messages.length,
    );

    const nextToken = page.nextPageToken ?? null;
    if (nextToken) metaSet(ctx.sql, "next_page_token", nextToken);
    else ctx.sql.exec("DELETE FROM meta WHERE key = 'next_page_token'");
    metaSet(ctx.sql, "pages_fetched", String(pageIndex + 1));
    metaSet(
      ctx.sql,
      "messages_fetched",
      String(Number(metaGet(ctx.sql, "messages_fetched") ?? "0") + messages.length),
    );

    log("page_stored", {
      sourceId: current.source.id,
      runId: ctx.runId,
      pageIndex,
      messages: messages.length,
      subrequests: ctx.budget.spent,
    });

    if (!nextToken) {
      metaSet(ctx.sql, "listing_complete", "1");
      return { phaseComplete: true };
    }
  }
  return { phaseComplete: false };
}

export async function stepIndexing(
  ctx: ChatImportTickContext,
  current: Current,
): Promise<StepOutcome> {
  const pages = ctx.sql
    .exec<{ page_index: number; r2_key: string }>(
      "SELECT page_index, r2_key FROM pages ORDER BY page_index",
    )
    .toArray();
  let pageCursor = Number(metaGet(ctx.sql, "indexing_page") ?? "0");
  while (pageCursor < pages.length) {
    if (!ctx.budget.canSpend(1)) return { phaseComplete: false };
    const page = pages[pageCursor];
    if (!page) break;
    ctx.budget.spend(1);
    const object = await ctx.env.BUCKET.get(page.r2_key);
    if (!object) throw new Error(`Missing Chat import page object: ${page.r2_key}`);
    const body = (await object.json()) as { messages?: ChatMessage[] };
    // An incremental run only learns here whether anything is new; the open document is
    // then re-fetched whole (regenerateOpenDocument), new messages included.
    if (current.run.sinceCursor) {
      if ((body.messages ?? []).length > 0) metaSet(ctx.sql, "has_new_messages", "1");
    } else {
      for (const [messageIndex, message] of (body.messages ?? []).entries()) {
        indexMessage(ctx.sql, message, `unnamed-${page.page_index}-${messageIndex}`);
      }
    }
    pageCursor += 1;
    metaSet(ctx.sql, "indexing_page", String(pageCursor));
  }
  if (current.run.sinceCursor && !(await regenerateOpenDocument(ctx, current))) {
    return { phaseComplete: false };
  }
  return { phaseComplete: true };
}

/**
 * When the delta had new messages, index every message from the open document's first
 * week onward (before sender and attachment processing), so grouping packs the open
 * document (and any that follow it) whole.
 */
async function regenerateOpenDocument(
  ctx: ChatImportTickContext,
  current: Current,
): Promise<boolean> {
  if (metaGet(ctx.sql, "open_regenerated") === "1") return true;
  if (metaGet(ctx.sql, "has_new_messages") !== "1") {
    metaSet(ctx.sql, "open_regenerated", "1");
    return true;
  }
  const openWeek = await resolveOpenDocument(ctx, current, {
    pathPrefix: "",
    fallbackWeek: weekPathFromCreateTime(current.run.sinceCursor ?? ""),
  });
  if (!openWeek) return false;
  const bounds = weekBoundsRfc3339(openWeek);
  if (!bounds) throw new Error(`Invalid Chat document week: ${openWeek}`);
  const spaceName = spaceNameOf(current.source);

  while (true) {
    if (!ctx.budget.canSpend(1)) return false;
    const params = new URLSearchParams({
      pageSize: String(CHAT_PAGE_SIZE),
      filter: `createTime >= "${bounds.start}"`,
    });
    const pageToken = metaGet(ctx.sql, "open_regenerate_token");
    if (pageToken) params.set("pageToken", pageToken);
    ctx.budget.spend(1);
    const response = await fetchWithTimeout(
      `https://chat.googleapis.com/v1/${spaceName}/messages?${params}`,
      { headers: { Authorization: `Bearer ${requireAccessToken(ctx)}` } },
    );
    if (!response.ok) {
      await logGoogleChatMessagesListError(response, {
        spaceName,
        filter: params.get("filter"),
        hasPageToken: Boolean(pageToken),
      });
      throw new Error(`Google Chat messages.list failed (${response.status})`);
    }
    const page = (await response.json()) as { messages?: ChatMessage[]; nextPageToken?: string };
    const pageIndex = Number(metaGet(ctx.sql, "open_regenerate_page") ?? "0");
    for (const [messageIndex, message] of (page.messages ?? []).entries()) {
      indexMessage(ctx.sql, message, `open-${pageIndex}-${messageIndex}`);
    }
    if (!page.nextPageToken) break;
    metaSet(ctx.sql, "open_regenerate_token", page.nextPageToken);
    metaSet(ctx.sql, "open_regenerate_page", String(pageIndex + 1));
  }
  metaSet(ctx.sql, "open_regenerated", "1");
  return true;
}
