import type { DeskPatch } from "~/features/board/protocol";
import { requireEventAccess } from "~/features/events/access.server";

export async function updateLayout(env: Env, request: Request, rawSlug: string | undefined) {
  const { event } = await requireEventAccess(env, request, rawSlug);
  const board = env.OST_BOARD.getByName(event.slug);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const num = (k: string) => Number.parseFloat(String(form.get(k) ?? ""));

  switch (intent) {
    case "addDesk":
      await board.addDesk({ x: num("x") || 0, y: num("y") || 0 });
      break;
    case "updateDesk": {
      const patch: DeskPatch = {};
      for (const k of ["x", "y", "width", "height", "rotation"] as const) {
        const v = num(k);
        if (!Number.isNaN(v)) patch[k] = v;
      }
      const label = form.get("label");
      if (typeof label === "string") patch.label = label;
      await board.updateDesk(String(form.get("id") ?? ""), patch);
      break;
    }
    case "removeDesk":
      await board.removeDesk(String(form.get("id") ?? ""));
      break;
    case "autoAssign":
      await board.autoAssignDesks();
      break;
    case "clearAssign":
      await board.clearAssignments();
      break;
    case "deleteTopic":
      await board.deleteTopic(String(form.get("topicId") ?? ""));
      break;
    case "clearTopics":
      await board.clearTopics();
      break;
  }
  return { ok: true };
}
