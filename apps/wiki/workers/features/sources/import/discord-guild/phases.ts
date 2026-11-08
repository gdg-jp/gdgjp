import { and, eq, like, ne } from "drizzle-orm";
import * as schema from "../../../../../app/db/schema";
import {
  DISCORD_CATEGORY_CHANNEL_TYPE,
  DISCORD_IMPORTABLE_CHANNEL_TYPES,
  type DiscordChannel,
  listGuildChannels,
} from "../../../../../app/features/discord/api.server";
import { DISCORD_BOT_ACCESS_MESSAGE } from "../../../../../app/features/discord/oauth.server";
import { parseDiscordGuildConfig } from "../../../../../app/features/sources/classify";
import { MARKDOWN_MEDIA_TYPE, pathForMediaType } from "../../media-type";
import { archiveMissingDocuments } from "../archive";
import { stepAttachments } from "../discord/attachments";
import { deleteRunTempObjects, stepFinalizing, stepGrouping } from "../discord/finalize";
import { stepListing } from "../discord/listing";
import type { Current, DiscordImportTickContext, StepOutcome } from "../discord/shared";
import { log, requireBotToken } from "../discord/shared";
import { ARCHIVE_MISSING_SUBREQUESTS, metaGet, metaSet } from "../run";
import type { ImportKindDriver } from "../tick";

/**
 * Discord server source (`kind = discord-guild`, external_id = guild snowflake).
 *
 * `discover` lists the server's channels and keeps the ones the source config selects.
 * `channels` then runs each selected channel through the existing channel steps
 * (listing → attachments → grouping → finalizing), one at a time, with the channel's own
 * incremental cursor and its documents under `channels/<channelId>/`. Channel ids rather
 * than names keep paths stable across renames; titles carry the names.
 */
type GuildPhase = "discover" | "channels";
type ChannelStep = "listing" | "attachments" | "grouping" | "finalizing";
const CHANNEL_STEPS: ChannelStep[] = ["listing", "attachments", "grouping", "finalizing"];

/** DO-local tables private to this driver (object-local SQL costs no subrequests). */
function ensureGuildTables(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS guild_channels (
      idx INTEGER PRIMARY KEY,
      channel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category_name TEXT
    );
    CREATE TABLE IF NOT EXISTS guild_paths (path TEXT PRIMARY KEY);
    -- Open documents an incremental channel run rebuilt (see import/open-document.ts).
    CREATE TABLE IF NOT EXISTS guild_replaced (path TEXT PRIMARY KEY);
  `);
}

/** Per-channel scratch state the channel steps keep in the shared DO tables. */
function resetChannelState(sql: SqlStorage): void {
  for (const table of ["pages", "week_messages", "attachments", "week_documents"]) {
    sql.exec(`DELETE FROM ${table}`);
  }
  sql.exec(
    "DELETE FROM meta WHERE key NOT LIKE 'guild\\_%' ESCAPE '\\' AND key <> 'pending_phase'",
  );
}

export function channelPathPrefix(channelId: string): string {
  return `channels/${channelId}/`;
}

/** Channels a config selects from the server's current channel list. */
export function selectGuildChannels(
  channels: readonly DiscordChannel[],
  configJson: string | null,
): Array<{ id: string; name: string; categoryName: string | null }> {
  const config = parseDiscordGuildConfig(configJson);
  if (!config) return [];
  const include = new Set(config.include.channels);
  const categories = new Set(config.include.categories);
  const exclude = new Set(config.exclude.channels);
  const categoryNames = new Map(
    channels
      .filter((channel) => channel.type === DISCORD_CATEGORY_CHANNEL_TYPE)
      .map((channel) => [channel.id, channel.name]),
  );
  return channels
    .filter((channel) => DISCORD_IMPORTABLE_CHANNEL_TYPES.has(channel.type))
    .filter((channel) => {
      if (exclude.has(channel.id)) return false;
      if (config.all || include.has(channel.id)) return true;
      return config.autoDiscover && !!channel.parent_id && categories.has(channel.parent_id);
    })
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id))
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      categoryName: channel.parent_id ? (categoryNames.get(channel.parent_id) ?? null) : null,
    }));
}

async function stepDiscover(ctx: DiscordImportTickContext, current: Current): Promise<StepOutcome> {
  ensureGuildTables(ctx.sql);
  if (metaGet(ctx.sql, "guild_discovered") === "1") return { phaseComplete: true };
  if (!ctx.budget.canSpend(1)) return { phaseComplete: false };
  const guildId = current.source.externalId;
  if (!guildId) throw new Error("Discord server source is missing a guild id");
  ctx.budget.spend(1);
  let channels: DiscordChannel[];
  try {
    channels = await listGuildChannels(requireBotToken(ctx), guildId);
  } catch (error) {
    if ((error as Error & { code?: string }).code === "bot_missing") {
      throw new Error(DISCORD_BOT_ACCESS_MESSAGE);
    }
    throw error;
  }
  const selected = selectGuildChannels(channels, current.source.config);
  ctx.sql.exec("DELETE FROM guild_channels");
  ctx.sql.exec("DELETE FROM guild_paths");
  ctx.sql.exec("DELETE FROM guild_replaced");
  selected.forEach((channel, idx) => {
    ctx.sql.exec(
      "INSERT INTO guild_channels (idx, channel_id, name, category_name) VALUES (?, ?, ?, ?)",
      idx,
      channel.id,
      channel.name,
      channel.categoryName,
    );
  });
  metaSet(ctx.sql, "guild_channel_index", "0");
  metaSet(ctx.sql, "guild_discovered", "1");
  log("guild_discovered", { sourceId: current.source.id, channels: selected.length });
  return { phaseComplete: true };
}

async function stepChannels(ctx: DiscordImportTickContext, current: Current): Promise<StepOutcome> {
  ensureGuildTables(ctx.sql);
  const channels = ctx.sql
    .exec<{ idx: number; channel_id: string; name: string; category_name: string | null }>(
      "SELECT idx, channel_id, name, category_name FROM guild_channels ORDER BY idx",
    )
    .toArray();
  let index = Number(metaGet(ctx.sql, "guild_channel_index") ?? "0");

  while (index < channels.length) {
    const channel = channels[index];
    if (!channel) break;
    const prefix = channelPathPrefix(channel.channel_id);

    if (metaGet(ctx.sql, "guild_channel_started") !== String(index)) {
      // Fresh channel: clear the previous channel's scratch state and read this channel's
      // own incremental cursor (the newest message already persisted under its prefix).
      if (!ctx.budget.canSpend(1)) return { phaseComplete: false };
      resetChannelState(ctx.sql);
      ctx.budget.spend(1);
      const row = await current.db
        .select({ cursor: schema.sourceDocuments.cursor })
        .from(schema.sourceDocuments)
        .where(
          and(
            eq(schema.sourceDocuments.sourceId, current.source.id),
            like(schema.sourceDocuments.path, `${prefix}%`),
            ne(schema.sourceDocuments.status, "archived"),
          ),
        )
        .all();
      const since = row
        .map((r) => r.cursor)
        .filter((c): c is string => !!c)
        .sort((a, b) => a.length - b.length || a.localeCompare(b))
        .at(-1);
      metaSet(ctx.sql, "guild_channel_since", since ?? "");
      metaSet(ctx.sql, "guild_channel_step", "listing");
      metaSet(ctx.sql, "guild_channel_started", String(index));
    }

    const since = metaGet(ctx.sql, "guild_channel_since") || null;
    const channelCtx: DiscordImportTickContext = {
      ...ctx,
      channelDocument: {
        pathPrefix: prefix,
        titlePrefix: `#${channel.name} — `,
      },
    };
    const channelCurrent: Current = {
      ...current,
      source: { ...current.source, externalId: channel.channel_id },
      run: { ...current.run, sinceCursor: since },
    };

    let step = (metaGet(ctx.sql, "guild_channel_step") ?? "listing") as ChannelStep;
    let unreadable = false;
    while (true) {
      let outcome: StepOutcome;
      try {
        outcome =
          step === "listing"
            ? await stepListing(channelCtx, channelCurrent)
            : step === "attachments"
              ? await stepAttachments(channelCtx, channelCurrent)
              : step === "grouping"
                ? await stepGrouping(channelCtx, channelCurrent)
                : await stepFinalizing(channelCtx, channelCurrent);
      } catch (error) {
        // A whole-server source lists every text channel, including private ones the bot
        // was never given. One such channel must not fail the server: skip it, keep its
        // earlier documents, and import the rest.
        if (step === "listing" && (error as Error).message === DISCORD_BOT_ACCESS_MESSAGE) {
          unreadable = true;
          break;
        }
        throw error;
      }
      if (!outcome.phaseComplete) return outcome;
      const next = CHANNEL_STEPS[CHANNEL_STEPS.indexOf(step) + 1];
      if (!next) break;
      step = next;
      metaSet(ctx.sql, "guild_channel_step", step);
    }

    if (unreadable) {
      await deleteRunTempObjects(channelCtx, current.source.id);
      index += 1;
      metaSet(ctx.sql, "guild_channel_index", String(index));
      log("guild_channel_skipped", {
        sourceId: current.source.id,
        channelId: channel.channel_id,
        name: channel.name,
        reason: "bot_cannot_read",
      });
      continue;
    }

    // Channel done: remember its documents, drop its temporary R2 objects, move on.
    for (const row of ctx.sql
      .exec<{ week_path: string }>("SELECT week_path FROM week_documents")
      .toArray()) {
      ctx.sql.exec(
        "INSERT OR IGNORE INTO guild_paths (path) VALUES (?)",
        pathForMediaType(`${prefix}${row.week_path}`, MARKDOWN_MEDIA_TYPE),
      );
    }
    const replaced = metaGet(ctx.sql, "open_path");
    if (replaced) {
      ctx.sql.exec("INSERT OR IGNORE INTO guild_replaced (path) VALUES (?)", replaced);
    }
    await deleteRunTempObjects(channelCtx, current.source.id);
    index += 1;
    metaSet(ctx.sql, "guild_channel_index", String(index));
    log("guild_channel_imported", {
      sourceId: current.source.id,
      channelId: channel.channel_id,
      index,
      of: channels.length,
    });
  }
  return { phaseComplete: ctx.budget.canSpend(ARCHIVE_MISSING_SUBREQUESTS + 4) };
}

async function completeGuildImport(ctx: DiscordImportTickContext, current: Current): Promise<void> {
  ensureGuildTables(ctx.sql);
  const selectedPrefixes = ctx.sql
    .exec<{ channel_id: string }>("SELECT channel_id FROM guild_channels")
    .toArray()
    .map((row) => channelPathPrefix(row.channel_id));
  const written = ctx.sql
    .exec<{ path: string }>("SELECT path FROM guild_paths")
    .toArray()
    .map((row) => row.path);

  // Keep older documents of channels that are still selected, except an open document a
  // channel run rebuilt (it is in `written` again when a document still starts there);
  // documents of channels that were deselected (or deleted from the server) are archived.
  ctx.budget.spend(1);
  const existing = await current.db
    .select({ path: schema.sourceDocuments.path })
    .from(schema.sourceDocuments)
    .where(
      and(
        eq(schema.sourceDocuments.sourceId, current.source.id),
        ne(schema.sourceDocuments.status, "archived"),
      ),
    )
    .all();
  const replaced = new Set(
    ctx.sql
      .exec<{ path: string }>("SELECT path FROM guild_replaced")
      .toArray()
      .map((row) => row.path),
  );
  const retained = new Set(written);
  for (const row of existing) {
    if (replaced.has(row.path)) continue;
    if (selectedPrefixes.some((prefix) => row.path.startsWith(prefix))) retained.add(row.path);
  }

  ctx.budget.spend(ARCHIVE_MISSING_SUBREQUESTS);
  await archiveMissingDocuments(
    current.db,
    current.source.id,
    current.run.fetchAttemptId,
    [...retained],
    ctx.env.BUCKET,
  );

  ctx.budget.spend(1);
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

  ctx.budget.spend(1);
  await current.db
    .update(schema.sourceImportRuns)
    .set({ phase: "complete", consecutiveFailures: 0, updatedAt: new Date() })
    .where(eq(schema.sourceImportRuns.id, ctx.runId));

  log("guild_import_completed", {
    sourceId: current.source.id,
    runId: ctx.runId,
    channels: selectedPrefixes.length,
    documents: written.length,
    subrequests: ctx.budget.spent,
  });
}

export const discordGuildImportDriver: ImportKindDriver<GuildPhase> = {
  kind: "discord-guild",
  phases: ["discover", "channels"],
  needsAccessToken: false,
  requiredScopes: [],
  async step(phase, ctx, current) {
    const discordCtx = ctx as DiscordImportTickContext;
    const discordCurrent = current as Current;
    if (phase === "discover") return stepDiscover(discordCtx, discordCurrent);
    return stepChannels(discordCtx, discordCurrent);
  },
  complete(ctx, current) {
    return completeGuildImport(ctx as DiscordImportTickContext, current as Current);
  },
};
