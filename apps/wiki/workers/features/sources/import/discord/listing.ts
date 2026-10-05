import {
  type DiscordMessage,
  listChannelMessages,
  snowflakeFromUnixMs,
} from "../../../../../app/features/discord/api.server";
import { DISCORD_BOT_ACCESS_MESSAGE } from "../../../../../app/features/discord/oauth.server";
import { weekBoundsRfc3339, weekPathFromCreateTime } from "../../google-chat";
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
    if (current.run.sinceCursor && !(await regenerateTouchedWeeks(ctx, current))) {
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
        // Discord returns ascending when using `after`. Advance with the newest id.
        const newest = messages[messages.length - 1];
        if (newest) metaSet(ctx.sql, cursorKey, newest.id);
      } else {
        messages = await listChannelMessages(botToken, channelId, {
          limit: DISCORD_PAGE_SIZE,
          before: pageCursor ?? undefined,
        });
        // Discord returns descending when using `before`. Advance with the oldest id.
        const oldest = messages[messages.length - 1];
        if (oldest) metaSet(ctx.sql, cursorKey, oldest.id);
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

    for (const message of messages) {
      if (incremental) {
        const weekPath = weekPathFromCreateTime(message.timestamp);
        if (weekPath) {
          ctx.sql.exec("INSERT OR IGNORE INTO touched_weeks (week_path) VALUES (?)", weekPath);
        }
      } else {
        indexMessage(ctx.sql, message);
      }
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
  if (current.run.sinceCursor && !(await regenerateTouchedWeeks(ctx, current))) {
    return { phaseComplete: false };
  }
  return { phaseComplete: true };
}

/** Re-fetch every delta-touched week so merge persists a complete weekly document. */
async function regenerateTouchedWeeks(
  ctx: DiscordImportTickContext,
  current: Current,
): Promise<boolean> {
  if (metaGet(ctx.sql, "weeks_regenerated") === "1") return true;
  const weeks = ctx.sql
    .exec<{ week_path: string }>("SELECT week_path FROM touched_weeks ORDER BY week_path")
    .toArray();
  let index = Number(metaGet(ctx.sql, "weeks_regenerate_index") ?? "0");
  const botToken = requireBotToken(ctx);
  const channelId = channelIdOf(current.source);

  while (index < weeks.length) {
    const weekPath = weeks[index]?.week_path;
    if (!weekPath) break;
    const startedKey = `week_regenerate_started:${weekPath}`;
    const afterKey = `week_regenerate_after:${weekPath}`;
    if (metaGet(ctx.sql, startedKey) !== "1") {
      ctx.sql.exec(
        `DELETE FROM attachments WHERE message_name IN (
           SELECT thread_name FROM week_messages WHERE week_path = ?
         )`,
        weekPath,
      );
      ctx.sql.exec("DELETE FROM week_messages WHERE week_path = ?", weekPath);
      metaSet(ctx.sql, startedKey, "1");
    }
    if (!ctx.budget.canSpend(1)) return false;

    const bounds = weekBoundsRfc3339(weekPath);
    if (!bounds) throw new Error(`Invalid Discord week path: ${weekPath}`);
    const after = metaGet(ctx.sql, afterKey) ?? snowflakeFromUnixMs(Date.parse(bounds.start) - 1);
    const before = snowflakeFromUnixMs(Date.parse(bounds.end));

    ctx.budget.spend(1);
    let messages: DiscordMessage[];
    try {
      messages = await listChannelMessages(botToken, channelId, {
        limit: DISCORD_PAGE_SIZE,
        after,
        before,
      });
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      if (code === "bot_missing") throw new Error(DISCORD_BOT_ACCESS_MESSAGE);
      throw error;
    }

    for (const message of messages) {
      const messageWeek = weekPathFromCreateTime(message.timestamp);
      if (messageWeek !== weekPath) continue;
      indexMessage(ctx.sql, message);
    }

    if (messages.length >= DISCORD_PAGE_SIZE) {
      const newest = messages[messages.length - 1];
      if (newest) {
        metaSet(ctx.sql, afterKey, newest.id);
        continue;
      }
    }
    ctx.sql.exec("DELETE FROM meta WHERE key IN (?, ?)", startedKey, afterKey);
    index += 1;
    metaSet(ctx.sql, "weeks_regenerate_index", String(index));
  }
  metaSet(ctx.sql, "weeks_regenerated", "1");
  return true;
}
