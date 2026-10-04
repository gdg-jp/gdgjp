import { requireEventAccess } from "~/features/events/access.server";

export async function moderateBoard(env: Env, request: Request, rawSlug: string | undefined) {
  const { event } = await requireEventAccess(env, request, rawSlug);
  const board = env.OST_BOARD.getByName(event.slug);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "merge") {
    const sourceId = String(form.get("sourceId") ?? "");
    const targetId = String(form.get("targetId") ?? "");
    if (sourceId && targetId) await board.mergeTopics(sourceId, targetId);
  } else if (intent === "ungroup") {
    const topicId = String(form.get("topicId") ?? "");
    if (topicId) await board.ungroupTopic(topicId);
  } else if (intent === "delete") {
    const topicId = String(form.get("topicId") ?? "");
    if (topicId) await board.deleteTopic(topicId);
  } else if (intent === "clear") {
    await board.clearTopics();
  }
  return { ok: true };
}
