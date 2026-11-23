import {
  type DiscordMessage,
  listChannelMessages,
  snowflakeFromUnixMs,
} from "../../../../../app/features/discord/api.server";
import { DISCORD_BOT_ACCESS_MESSAGE } from "../../../../../app/features/discord/oauth.server";
import { weekBoundsRfc3339, weekPathFromCreateTime } from "../../google-chat";
import { resolveOpenDocument } from "../open-document";
import { metaGet, metaSet } from "../run";
import {
  type Current,
  DISCORD_PAGE_SIZE,
  type DiscordImportTickContext,
  type StepOutcome,
  channelIdOf,
  indexMessage,
  log,
  requireBotToken,
} from "./shared";

export async function stepListing(
  ctx: DiscordImportTickContext,
  current: Current,
): Promise<StepOutcome> {
  if (metaGet(ctx.sql, "listing_complete") === "1") {
    if (current.run.sinceCursor && !(await regenerateOpenDocument(ctx, current))) {
      return { phaseComplete: false };
    }
    return { phaseComplete: true };
  }

  const botToken = requireBotToken(ctx);
  const channelId = channelIdOf(current.source);
  const incremental = Boolean(current.run.sinceCursor);

  while (ctx.budget.canSpend(2)) {
    const pageIndex = Number(metaGet(ctx.sql, "pages_fetched") ?? "0");
    const cursorKey = incremental ? "after_message_id" : "before_message_id";
    const pageCursor = metaGet(ctx.sql, cursorKey);

    let messages: DiscordMessage[];
    try {
      ctx.budget.spend(1);
      if (incremental) {
        const after =
          pageCursor ?? (pageIndex === 0 ? (current.run.sinceCursor as string) : undefined);
        if (!after && pageIndex > 0) {
          metaSet(ctx.sql, "listing_complete", "1");
          break;
        }
        messages = await listChannelMessages(botToken, channelId, {
          limit: DISCORD_PAGE_SIZE,
          after: after ?? current.run.sinceCursor ?? undefined,
        });
        const newest = newestMessageId(messages);
        if (newest) metaSet(ctx.sql, cursorKey, newest);
      } else {
        messages = await listChannelMessages(botToken, channelId, {
          limit: DISCORD_PAGE_SIZE,
          before: pageCursor ?? undefined,
        });
        const oldest = oldestMessageId(messages);
        if (oldest) metaSet(ctx.sql, cursorKey, oldest);
      }
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      if (code === "bot_missing") throw new Error(DISCORD_BOT_ACCESS_MESSAGE);
      throw error;
    }

    const r2Key = `raw/${current.source.id}/discord-runs/${ctx.runId}/pages/${pageIndex}.json`;
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

    if (incremental) {
      if (messages.length > 0) metaSet(ctx.sql, "has_new_messages", "1");
    } else {
      for (const message of messages) indexMessage(ctx.sql, message);
    }

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

    if (messages.length < DISCORD_PAGE_SIZE) {
      metaSet(ctx.sql, "listing_complete", "1");
      break;
    }
  }

  if (metaGet(ctx.sql, "listing_complete") !== "1") return { phaseComplete: false };
  if (current.run.sinceCursor && !(await regenerateOpenDocument(ctx, current))) {
    return { phaseComplete: false };
  }
  return { phaseComplete: true };
}

function newestMessageId(messages: readonly DiscordMessage[]): string | undefined {
  return messages.reduce<string | undefined>(
    (newest, message) =>
      newest === undefined || BigInt(message.id) > BigInt(newest) ? message.id : newest,
    undefined,
  );
}

function oldestMessageId(messages: readonly DiscordMessage[]): string | undefined {
  return messages.reduce<string | undefined>(
    (oldest, message) =>
      oldest === undefined || BigInt(message.id) < BigInt(oldest) ? message.id : oldest,
    undefined,
  );
}

function weekOfSnowflake(id: string): string | null {
  try {
    const unixMs = Number((BigInt(id) >> 22n) + 1420070400000n);
    return weekPathFromCreateTime(new Date(unixMs).toISOString());
  } catch {
    return null;
  }
}

async function regenerateOpenDocument(
  ctx: DiscordImportTickContext,
  current: Current,
): Promise<boolean> {
  if (metaGet(ctx.sql, "open_regenerated") === "1") return true;
  if (metaGet(ctx.sql, "has_new_messages") !== "1") {
    metaSet(ctx.sql, "open_regenerated", "1");
    return true;
  }
  const openWeek = await resolveOpenDocument(ctx, current, {
    pathPrefix: ctx.channelDocument?.pathPrefix ?? "",
    fallbackWeek: weekOfSnowflake(current.run.sinceCursor ?? ""),
  });
  if (!openWeek) return false;
  const bounds = weekBoundsRfc3339(openWeek);
  if (!bounds) throw new Error(`Invalid Discord document week: ${openWeek}`);
  const botToken = requireBotToken(ctx);
  const channelId = channelIdOf(current.source);

  while (true) {
    if (!ctx.budget.canSpend(1)) return false;
    const after =
      metaGet(ctx.sql, "open_regenerate_after") ??
      snowflakeFromUnixMs(Date.parse(bounds.start) - 1);
    ctx.budget.spend(1);
    let messages: DiscordMessage[];
    try {
      messages = await listChannelMessages(botToken, channelId, {
        limit: DISCORD_PAGE_SIZE,
        after,
      });
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      if (code === "bot_missing") throw new Error(DISCORD_BOT_ACCESS_MESSAGE);
      throw error;
    }
    for (const message of messages) indexMessage(ctx.sql, message);
    const newest = newestMessageId(messages);
    if (messages.length < DISCORD_PAGE_SIZE || !newest) break;
    metaSet(ctx.sql, "open_regenerate_after", newest);
  }
  metaSet(ctx.sql, "open_regenerated", "1");
  return true;
}
