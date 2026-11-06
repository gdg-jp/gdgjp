import type { App } from "../../app";
import { createLinkUrl, getLinkedToken, unlink } from "../auth/accounts";
import { startInquiry } from "../inquiry/inquiry";
import { chooseReader } from "../inquiry/reader";
import { sendFeedbackScore } from "../telemetry/langfuse";

/** Discord MANAGE_GUILD permission bit — required for /setup. */
const MANAGE_GUILD = 1n << 5n;
const EPHEMERAL = 64;

type Interaction = {
  id: string;
  type: number;
  token: string;
  application_id: string;
  guild_id?: string;
  member?: { user?: { id: string }; permissions?: string };
  user?: { id: string };
  data?: {
    name?: string;
    custom_id?: string;
    values?: string[];
    options?: Array<{ name: string; value: unknown }>;
  };
};

const json = (body: unknown) => Response.json(body);
const ephemeral = (content: string) =>
  json({ type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } });

/** Route one verified interaction. Long work goes to ctx.waitUntil after a deferred response. */
export async function handleDiscordInteraction(
  app: App,
  interaction: Interaction,
  ctx: ExecutionContext,
): Promise<Response> {
  const userId = interaction.member?.user?.id ?? interaction.user?.id ?? "";
  if (interaction.type === 2) {
    switch (interaction.data?.name) {
      case "ask": {
        const question = String(
          interaction.data.options?.find((o) => o.name === "question")?.value ?? "",
        ).trim();
        if (!question) return ephemeral("質問を入力してください。");
        ctx.waitUntil(runAsk(app, interaction, userId, question, false));
        return json({ type: 5 });
      }
      case "login":
        return ephemeral(
          `GDG Accounts と連携するにはこのリンクを開いてください（DM と「自分の権限で再回答」で、あなたの権限で回答します）:\n${await createLinkUrl("discord", userId, app.auth)}`,
        );
      case "unlink":
        return ephemeral(
          (await unlink("discord", userId, app.auth))
            ? "連携を解除しました。"
            : "連携されたアカウントはありません。",
        );
      case "setup":
        return setup(app, interaction, userId);
      default:
        return ephemeral("Unknown command.");
    }
  }
  if (interaction.type === 3) {
    const id = interaction.data?.custom_id ?? "";
    const [kind, a, b] = id.split(":");
    if (kind === "fb" && b) {
      ctx.waitUntil(sendFeedbackScore(app.env, b, a === "up" ? 1 : 0, "discord"));
      return ephemeral("フィードバックありがとうございます。");
    }
    if (kind === "ra" && a) {
      const row = await app.pending.get(a);
      if (!row) return ephemeral("元の質問が見つかりませんでした。");
      ctx.waitUntil(runAsk(app, interaction, userId, row.question, true));
      return json({ type: 5, data: { flags: EPHEMERAL } });
    }
    if (kind === "setup" && a) return completeSetup(app, interaction, userId, a);
  }
  return ephemeral("Unsupported interaction.");
}

async function runAsk(
  app: App,
  interaction: Interaction,
  userId: string,
  question: string,
  privateReply: boolean,
): Promise<void> {
  const delivery = {
    platform: "discord" as const,
    applicationId: interaction.application_id,
    interactionToken: interaction.token,
    ephemeral: privateReply,
  };
  try {
    const venue = interaction.guild_id
      ? ({ kind: "discord_guild", guildId: interaction.guild_id } as const)
      : ({ kind: "discord_dm" } as const);
    const needsUser = privateReply || venue.kind === "discord_dm";
    const linked = needsUser
      ? await getLinkedToken("discord", userId, app.auth)
      : { status: "none" as const };
    if (privateReply && linked.status !== "ok") {
      await app.deliver(delivery, {
        text: "自分の権限で再回答するには、先に /login で連携してください。",
        citations: [],
        degraded: true,
        publicReply: false,
        jobId: "",
      });
      return;
    }
    const reader = chooseReader(
      venue,
      linked.status === "ok" ? linked.accessToken : null,
      privateReply,
    );
    const spaces = venue.kind === "discord_guild" ? await app.guildSpaces(venue.guildId) : [];
    await startInquiry(
      {
        question,
        reader,
        venue,
        spaces,
        delivery,
        publicReply: venue.kind === "discord_guild" && !privateReply,
        platform: "discord",
        chatUserId: userId,
      },
      app.inquiry,
    );
  } catch (error) {
    console.error("agent: /ask failed", error);
    await app
      .deliver(delivery, {
        text: "回答を作れませんでした。少し待ってからもう一度お試しください。",
        citations: [],
        degraded: true,
        publicReply: false,
        jobId: "",
      })
      .catch(() => undefined);
  }
}

async function setup(app: App, interaction: Interaction, userId: string): Promise<Response> {
  if (!interaction.guild_id) return ephemeral("/setup はサーバ内で実行してください。");
  const permissions = BigInt(interaction.member?.permissions ?? "0");
  if ((permissions & MANAGE_GUILD) === 0n)
    return ephemeral("/setup にはサーバの管理権限が必要です。");
  const linked = await getLinkedToken("discord", userId, app.auth);
  if (linked.status !== "ok") return ephemeral("先に /login で GDG Accounts と連携してください。");
  const spaces = (await app.wiki.spaces({ kind: "user", token: linked.accessToken })).filter(
    (space) => space.role === "owner" && space.kind === "shared",
  );
  if (spaces.length === 0)
    return ephemeral(
      "あなたが owner の共有スペースがありません。wiki でスペースを作成してください。",
    );
  return json({
    type: 4,
    data: {
      flags: EPHEMERAL,
      content:
        "このサーバで /ask が検索するスペースを選んでください。サーバの全員がそのスペースの viewer になります。",
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: `setup:${interaction.guild_id}`,
              options: spaces.slice(0, 25).map((space) => ({
                label: space.name.slice(0, 100),
                value: space.slug,
                description: space.slug,
              })),
            },
          ],
        },
      ],
    },
  });
}

async function completeSetup(
  app: App,
  interaction: Interaction,
  userId: string,
  guildId: string,
): Promise<Response> {
  const slug = interaction.data?.values?.[0];
  const permissions = BigInt(interaction.member?.permissions ?? "0");
  if (!slug || interaction.guild_id !== guildId || (permissions & MANAGE_GUILD) === 0n)
    return ephemeral("設定できませんでした。");
  const linked = await getLinkedToken("discord", userId, app.auth);
  if (linked.status !== "ok") return ephemeral("先に /login で連携してください。");
  try {
    // The wiki checks that this user owns the space; the agent only records the choice.
    await app.wiki.addSpaceMember(linked.accessToken, slug, "discord_guild", guildId);
    await app.env.DB.prepare(
      "INSERT OR IGNORE INTO guild_spaces (guild_id, space_slug, granted_by) VALUES (?, ?, ?)",
    )
      .bind(guildId, slug, userId)
      .run();
  } catch (error) {
    console.error("agent: setup failed", error);
    return json({
      type: 7,
      data: {
        content: "スペースを追加できませんでした（owner 権限を確認してください）。",
        components: [],
      },
    });
  }
  return json({
    type: 7,
    data: { content: `スペース \`${slug}\` をこのサーバに追加しました。`, components: [] },
  });
}
