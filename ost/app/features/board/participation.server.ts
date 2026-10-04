import { data } from "react-router";
import { getEventBySlug } from "~/features/events/events.server";
import { normalizeSlug } from "~/features/events/slug";
import { normalizeTopicText } from "./protocol";
import { ensureVoterId } from "./voter-cookie.server";

export async function participate(env: Env, request: Request, rawSlug: string | undefined) {
  const slug = normalizeSlug(rawSlug);
  if (!slug) throw new Response(null, { status: 404 });
  const event = await getEventBySlug(env.DB, slug);
  if (!event) throw new Response(null, { status: 404 });

  const board = env.OST_BOARD.getByName(slug);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "vote") {
    const secure = !/^http:\/\/(localhost|127\.0\.0\.1)/.test(env.APP_URL);
    const voter = ensureVoterId(request, { secure });
    const topicId = String(form.get("topicId") ?? "");
    if (topicId) await board.toggleVote(topicId, voter.id);
    return voter.setCookie
      ? data({ ok: true as const }, { headers: { "Set-Cookie": voter.setCookie } })
      : data({ ok: true as const });
  }

  const text = normalizeTopicText(form.get("text"));
  if (!text) {
    return data({ ok: false as const, error: "テーマを入力してください（200文字以内）。" });
  }
  await board.submitTopic(text);
  return data({ ok: true as const, submitted: true });
}
