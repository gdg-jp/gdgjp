import {
  type ChatMessage,
  logGoogleChatMessagesListError,
  weekBoundsRfc3339,
  weekPathFromCreateTime,
} from "../../google-chat";
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
    for (const [messageIndex, message] of (body.messages ?? []).entries()) {
      if (current.run.sinceCursor) {
        if (!message.createTime) continue;
        const weekPath = weekPathFromCreateTime(message.createTime);
        if (weekPath) {
          ctx.sql.exec("INSERT OR IGNORE INTO touched_weeks (week_path) VALUES (?)", weekPath);
        }
      } else {
        indexMessage(ctx.sql, message, `unnamed-${page.page_index}-${messageIndex}`);
      }
    }
    pageCursor += 1;
    metaSet(ctx.sql, "indexing_page", String(pageCursor));
  }
  if (current.run.sinceCursor && !(await regenerateTouchedWeeks(ctx, current))) {
    return { phaseComplete: false };
  }
  return { phaseComplete: true };
}

/** Re-fetch and index every delta-touched week before sender/attachment processing. */
async function regenerateTouchedWeeks(
  ctx: ChatImportTickContext,
  current: Current,
): Promise<boolean> {
  if (metaGet(ctx.sql, "weeks_regenerated") === "1") return true;
  const weeks = ctx.sql
    .exec<{ week_path: string }>("SELECT week_path FROM touched_weeks ORDER BY week_path")
    .toArray();
  let index = Number(metaGet(ctx.sql, "weeks_regenerate_index") ?? "0");
  while (index < weeks.length) {
    const weekPath = weeks[index]?.week_path;
    if (!weekPath) break;
    const startedKey = `week_regenerate_started:${weekPath}`;
    const tokenKey = `week_regenerate_token:${weekPath}`;
    const pageKey = `week_regenerate_page:${weekPath}`;
    if (metaGet(ctx.sql, startedKey) !== "1") {
      ctx.sql.exec("DELETE FROM week_messages WHERE week_path = ?", weekPath);
      metaSet(ctx.sql, startedKey, "1");
    }
    if (!ctx.budget.canSpend(1)) return false;
    const bounds = weekBoundsRfc3339(weekPath);
    if (!bounds) throw new Error(`Invalid Chat week path: ${weekPath}`);
    const params = new URLSearchParams({
      pageSize: String(CHAT_PAGE_SIZE),
      filter: `createTime >= \"${bounds.start}\" AND createTime < \"${bounds.end}\"`,
    });
    const pageToken = metaGet(ctx.sql, tokenKey);
    if (pageToken) params.set("pageToken", pageToken);
    ctx.budget.spend(1);
    const response = await fetchWithTimeout(
      `https://chat.googleapis.com/v1/${spaceNameOf(current.source)}/messages?${params}`,
      { headers: { Authorization: `Bearer ${requireAccessToken(ctx)}` } },
    );
    if (!response.ok) {
      await logGoogleChatMessagesListError(response, {
        spaceName: spaceNameOf(current.source),
        filter: params.get("filter"),
        hasPageToken: Boolean(pageToken),
      });
      throw new Error(`Google Chat weekly messages.list failed (${response.status})`);
    }
    const page = (await response.json()) as { messages?: ChatMessage[]; nextPageToken?: string };
    const pageIndex = Number(metaGet(ctx.sql, pageKey) ?? "0");
    for (const [messageIndex, message] of (page.messages ?? []).entries()) {
      indexMessage(ctx.sql, message, `week-${index}-${pageIndex}-${messageIndex}`, weekPath);
    }
    if (page.nextPageToken) {
      metaSet(ctx.sql, tokenKey, page.nextPageToken);
      metaSet(ctx.sql, pageKey, String(pageIndex + 1));
      continue;
    }
    ctx.sql.exec("DELETE FROM meta WHERE key IN (?, ?, ?)", startedKey, tokenKey, pageKey);
    index += 1;
    metaSet(ctx.sql, "weeks_regenerate_index", String(index));
  }
  metaSet(ctx.sql, "weeks_regenerated", "1");
  return true;
}
