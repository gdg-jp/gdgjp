import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "~/db/schema";

const DISCORD_API = "https://discord.com/api/v10";

interface DueTask {
  taskId: string;
  taskNumber: number;
  taskTitle: string;
  pageSlug: string;
  listTitleJa: string;
  listTitleEn: string;
  discordId: string;
  preferredUiLanguage: string;
}

async function openDmChannel(token: string, userId: string): Promise<string | null> {
  const res = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: userId }),
  });
  if (!res.ok) {
    console.error(
      `[discord-reminders] Failed to open DM channel for user ${userId}: ${res.status} ${res.statusText}`,
    );
    return null;
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

async function sendMessage(
  token: string,
  channelId: string,
  content: string,
  mentionUserIds?: string[],
): Promise<void> {
  const allowed_mentions =
    mentionUserIds && mentionUserIds.length > 0
      ? { users: mentionUserIds }
      : { parse: [] as string[] };
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content, allowed_mentions }),
  });
  if (!res.ok) {
    console.error(
      `[discord-reminders] Failed to send message to channel ${channelId}: ${res.status} ${res.statusText}`,
    );
  }
}

interface ChannelTaskRow {
  taskId: string;
  taskNumber: number;
  taskTitle: string;
  pageSlug: string;
  listTitleJa: string;
  listTitleEn: string;
  discordId: string | null;
  assigneeName: string | null;
}

function buildChannelMessage(tasks: ChannelTaskRow[], baseUrl: string): string {
  const header = `本日が期限のタスクが${tasks.length}件あります / ${tasks.length} task${tasks.length === 1 ? "" : "s"} due today:`;
  const lines = tasks.map((t) => {
    const mention = t.discordId ? `<@${t.discordId}>` : (t.assigneeName ?? "unassigned");
    return `• #${t.taskNumber} ${t.taskTitle} (${mention})\n  ${baseUrl}/tasks/${t.pageSlug}`;
  });
  return `${header}\n${lines.join("\n")}`;
}

async function sendChannelReminders(
  env: Env,
  db: DrizzleD1Database<typeof schema>,
  todayJst: string,
  baseUrl: string,
): Promise<void> {
  const guilds = await db
    .select()
    .from(schema.discordGuildSettings)
    .where(eq(schema.discordGuildSettings.enabled, 1));

  if (guilds.length === 0) return;

  for (const guild of guilds) {
    try {
      const rows = await db
        .select({
          taskId: schema.tasks.id,
          taskNumber: schema.tasks.number,
          taskTitle: schema.tasks.title,
          pageSlug: schema.pages.slug,
          listTitleJa: schema.pages.titleJa,
          listTitleEn: schema.pages.titleEn,
          discordId: schema.user.discordId,
          assigneeName: schema.tasks.assigneeName,
        })
        .from(schema.tasks)
        .innerJoin(schema.taskLists, eq(schema.tasks.taskListId, schema.taskLists.pageId))
        .innerJoin(schema.pages, eq(schema.taskLists.pageId, schema.pages.id))
        .leftJoin(schema.user, eq(schema.tasks.assigneeId, schema.user.id))
        .where(
          and(
            eq(schema.tasks.dueDate, todayJst),
            inArray(schema.tasks.status, ["todo", "in_progress"]),
            eq(schema.pages.chapterId, guild.chapterId),
          ),
        );

      if (rows.length === 0) continue;

      const content = buildChannelMessage(rows, baseUrl);
      const mentionIds = rows.flatMap((r) => (r.discordId ? [r.discordId] : []));
      await sendMessage(env.DISCORD_BOT_TOKEN, guild.reminderChannelId, content, mentionIds);
      console.log(
        `[discord-reminders] sent ${rows.length} task(s) to guild ${guild.guildId} channel ${guild.reminderChannelId}`,
      );
    } catch (err) {
      console.error(
        `[discord-reminders] error sending channel reminder to guild ${guild.guildId}:`,
        err,
      );
    }
  }
}

function buildMessage(lang: string, tasks: DueTask[], baseUrl: string): string {
  const isJa = lang === "ja";
  const header = isJa
    ? `本日が期限のタスクが${tasks.length}件あります：`
    : `You have ${tasks.length} task${tasks.length === 1 ? "" : "s"} due today:`;

  const lines = tasks.map((t) => {
    const listTitle = isJa ? t.listTitleJa : t.listTitleEn;
    return `• [${listTitle}] #${t.taskNumber} ${t.taskTitle}\n  ${baseUrl}/tasks/${t.pageSlug}`;
  });

  return `${header}\n${lines.join("\n")}`;
}

export async function sendDueTaskReminders(env: Env): Promise<void> {
  if (!env.DISCORD_BOT_TOKEN) {
    console.warn("[discord-reminders] DISCORD_BOT_TOKEN not set, skipping");
    return;
  }

  // Compute today's date in JST (UTC+9). At 15:00 UTC + 9h = 00:00 JST next calendar day.
  const nowUtcMs = Date.now();
  const jstMs = nowUtcMs + 9 * 3600 * 1000;
  const todayJst = new Date(jstMs).toISOString().slice(0, 10);

  console.log(`[discord-reminders] querying tasks due on ${todayJst} (JST)`);

  const db = drizzle(env.DB, { schema });

  const rows = await db
    .select({
      taskId: schema.tasks.id,
      taskNumber: schema.tasks.number,
      taskTitle: schema.tasks.title,
      pageSlug: schema.pages.slug,
      listTitleJa: schema.pages.titleJa,
      listTitleEn: schema.pages.titleEn,
      discordId: schema.user.discordId,
      preferredUiLanguage: schema.user.preferredUiLanguage,
    })
    .from(schema.tasks)
    .innerJoin(schema.taskLists, eq(schema.tasks.taskListId, schema.taskLists.pageId))
    .innerJoin(schema.pages, eq(schema.taskLists.pageId, schema.pages.id))
    .innerJoin(schema.user, eq(schema.tasks.assigneeId, schema.user.id))
    .where(
      and(
        eq(schema.tasks.dueDate, todayJst),
        inArray(schema.tasks.status, ["todo", "in_progress"]),
        isNotNull(schema.tasks.assigneeId),
        isNotNull(schema.user.discordId),
      ),
    );

  if (rows.length === 0) {
    console.log("[discord-reminders] no tasks due today, nothing to send");
    return;
  }

  // Group tasks by Discord user ID
  const byUser = new Map<string, DueTask[]>();
  for (const row of rows) {
    if (!row.discordId) continue;
    const task: DueTask = {
      taskId: row.taskId,
      taskNumber: row.taskNumber,
      taskTitle: row.taskTitle,
      pageSlug: row.pageSlug,
      listTitleJa: row.listTitleJa,
      listTitleEn: row.listTitleEn,
      discordId: row.discordId,
      preferredUiLanguage: row.preferredUiLanguage,
    };
    const existing = byUser.get(row.discordId);
    if (existing) {
      existing.push(task);
    } else {
      byUser.set(row.discordId, [task]);
    }
  }

  const baseUrl = (env.BASE_URL ?? "https://wiki.gdgs.jp").replace(/\/+$/, "");
  console.log(`[discord-reminders] sending reminders to ${byUser.size} user(s)`);

  for (const [discordId, tasks] of byUser) {
    try {
      const channelId = await openDmChannel(env.DISCORD_BOT_TOKEN, discordId);
      if (!channelId) continue;

      const lang = tasks[0].preferredUiLanguage;
      const content = buildMessage(lang, tasks, baseUrl);
      await sendMessage(env.DISCORD_BOT_TOKEN, channelId, content);
      console.log(`[discord-reminders] sent ${tasks.length} task(s) to Discord user ${discordId}`);
    } catch (err) {
      console.error(`[discord-reminders] error sending to Discord user ${discordId}:`, err);
    }
  }

  await sendChannelReminders(env, db, todayJst, baseUrl);
}
