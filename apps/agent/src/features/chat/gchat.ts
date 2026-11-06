import type { App } from "../../app";
import { createLinkUrl, getLinkedToken, unlink } from "../auth/accounts";
import { startInquiry } from "../inquiry/inquiry";
import { type Venue, chooseReader } from "../inquiry/reader";
import { sendFeedbackScore } from "../telemetry/langfuse";
import { chatAccessToken } from "./gchat-auth";

/** Classic Google Chat app event (HTTP endpoint). */
type ChatEvent = {
  type: "MESSAGE" | "ADDED_TO_SPACE" | "REMOVED_FROM_SPACE" | "CARD_CLICKED";
  space?: { name: string; type?: string; spaceType?: string };
  user?: { name: string; displayName?: string };
  message?: { text?: string; argumentText?: string; thread?: { name?: string } };
  common?: { invokedFunction?: string; parameters?: Record<string, string> };
  action?: { actionMethodName?: string; parameters?: Array<{ key: string; value: string }> };
};

const text = (value: string) => Response.json({ text: value });

/**
 * The synchronous reply must come within 30 s, which an `answer` job does not fit. Reply
 * "調べています" now; the answer is posted into the same thread via the Chat API later.
 */
export async function handleChatEvent(
  app: App,
  event: ChatEvent,
  ctx: ExecutionContext,
): Promise<Response> {
  const userId = event.user?.name ?? "";
  const space = event.space?.name ?? "";
  const isDm = event.space?.type === "DM" || event.space?.spaceType === "DIRECT_MESSAGE";
  if (event.type === "ADDED_TO_SPACE")
    return text("GDG Japan Wiki のアシスタントです。メンションで質問してください。");
  if (event.type === "CARD_CLICKED") return cardClicked(app, event, userId, ctx);
  if (event.type !== "MESSAGE") return new Response(null, { status: 204 });

  const input = (event.message?.argumentText ?? event.message?.text ?? "").trim();
  if (/^\/unlink\b/i.test(input))
    return text(
      (await unlink("google-chat", userId, app.auth))
        ? "連携を解除しました。"
        : "連携されたアカウントはありません。",
    );
  if (/^\/login\b/i.test(input))
    return text(
      `GDG Accounts と連携するにはこのリンクを開いてください:\n${await createLinkUrl("google-chat", userId, app.auth)}`,
    );
  const setupMatch = /^\/setup\s+([a-z0-9-]+)/i.exec(input);
  if (setupMatch?.[1]) return setup(app, userId, space, setupMatch[1].toLowerCase(), isDm);
  if (!input) return text("質問を入力してください。");

  const venue: Venue = isDm ? { kind: "chat_dm" } : { kind: "chat_space", space };
  ctx.waitUntil(
    runAsk(
      app,
      venue,
      userId,
      input,
      { space, thread: event.message?.thread?.name ?? null },
      false,
    ),
  );
  return text("調べています…");
}

async function runAsk(
  app: App,
  venue: Venue,
  userId: string,
  question: string,
  target: { space: string; thread: string | null },
  privateReply: boolean,
): Promise<void> {
  const delivery = { platform: "google-chat" as const, space: target.space, thread: target.thread };
  try {
    const needsUser = privateReply || venue.kind === "chat_dm";
    const linked = needsUser
      ? await getLinkedToken("google-chat", userId, app.auth)
      : { status: "none" as const };
    const reader = chooseReader(
      venue,
      linked.status === "ok" ? linked.accessToken : null,
      privateReply,
    );
    const spaces = venue.kind === "chat_space" ? await app.chatSpaces(venue.space) : [];
    await startInquiry(
      {
        question,
        reader,
        venue,
        spaces,
        delivery,
        publicReply: venue.kind === "chat_space" && !privateReply,
        platform: "google-chat",
        chatUserId: userId,
      },
      app.inquiry,
    );
  } catch (error) {
    console.error("agent: chat ask failed", error);
  }
}

async function setup(
  app: App,
  userId: string,
  space: string,
  slug: string,
  isDm: boolean,
): Promise<Response> {
  if (isDm) return text("/setup はスペース内で実行してください。");
  const linked = await getLinkedToken("google-chat", userId, app.auth);
  if (linked.status !== "ok") return text("先に /login で GDG Accounts と連携してください。");
  try {
    await app.wiki.addSpaceMember(linked.accessToken, slug, "chat_space", space);
    await app.env.DB.prepare(
      "INSERT OR IGNORE INTO chat_spaces (chat_space, space_slug, granted_by) VALUES (?, ?, ?)",
    )
      .bind(space, slug, userId)
      .run();
  } catch {
    return text("スペースを追加できませんでした（wiki のスペース owner である必要があります）。");
  }
  return text(`wiki スペース ${slug} をこの Chat スペースに追加しました。`);
}

async function cardClicked(
  app: App,
  event: ChatEvent,
  userId: string,
  ctx: ExecutionContext,
): Promise<Response> {
  const fn = event.common?.invokedFunction ?? event.action?.actionMethodName;
  const params =
    event.common?.parameters ??
    Object.fromEntries((event.action?.parameters ?? []).map((p) => [p.key, p.value]));
  const jobId = params.jobId ?? "";
  if (fn === "feedback" && jobId) {
    ctx.waitUntil(sendFeedbackScore(app.env, jobId, params.value === "up" ? 1 : 0, "google-chat"));
    return Response.json({
      actionResponse: { type: "NEW_MESSAGE" },
      text: "フィードバックありがとうございます。",
    });
  }
  if (fn === "reanswer" && jobId) {
    const row = await app.pending.get(jobId);
    if (!row) return text("元の質問が見つかりませんでした。");
    // Chat has no ephemeral replies: answer with the asker's permissions in a DM.
    ctx.waitUntil(
      (async () => {
        const dm = await findDirectMessage(app, userId);
        if (dm)
          await runAsk(
            app,
            { kind: "chat_dm" },
            userId,
            row.question,
            { space: dm, thread: null },
            true,
          );
      })(),
    );
    return Response.json({
      actionResponse: { type: "NEW_MESSAGE" },
      text: "DM で回答します（連携済みの場合）。",
    });
  }
  return new Response(null, { status: 204 });
}

async function findDirectMessage(app: App, userId: string): Promise<string | null> {
  try {
    const token = await chatAccessToken(app.env.GOOGLE_CHAT_CREDENTIALS);
    const response = await fetch(
      `https://chat.googleapis.com/v1/spaces:findDirectMessage?name=${encodeURIComponent(userId)}`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) return null;
    return ((await response.json()) as { name?: string }).name ?? null;
  } catch {
    return null;
  }
}
