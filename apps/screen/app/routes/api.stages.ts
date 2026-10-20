import { data, redirect } from "react-router";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { cleanName } from "~/features/stage/room-state";
import { isStageId, normalizeStageId } from "~/features/stage/stage-id";
import {
  clampSlotCount,
  createStage,
  deleteStage,
  getStage,
  metaOf,
  renameStage,
  rotateOutputToken,
} from "~/features/stage/stages.server";
import type { Route } from "./+types/api.stages";

export function loader() {
  return redirect("/");
}

/** Stage mutations from the stage list and the control room (operators only). */
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { user } = await requireUserWithChapter(env, request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create") {
    const name = cleanName(form.get("name"));
    if (!name) return data({ ok: false as const, error: "name" }, { status: 400 });
    // The id is also the speaker invite link, so it is never swapped silently.
    const id = normalizeStageId(form.get("id"));
    if (!isStageId(id)) return data({ ok: false as const, error: "id" }, { status: 400 });
    const stage = await createStage(env.DB, {
      id,
      name,
      slotCount: clampSlotCount(form.get("slotCount")),
      createdBy: user.id,
    });
    if (!stage) return data({ ok: false as const, error: "id-taken" }, { status: 409 });
    return redirect(`/stages/${stage.id}`);
  }

  const stageId = form.get("stageId");
  if (!isStageId(stageId)) return data({ ok: false as const, error: "stage" }, { status: 400 });
  const stage = await getStage(env.DB, stageId);
  if (!stage) return data({ ok: false as const, error: "stage" }, { status: 404 });
  const room = env.STAGE.getByName(stage.id);

  if (intent === "rename") {
    const name = cleanName(form.get("name"));
    if (!name) return data({ ok: false as const, error: "name" }, { status: 400 });
    await renameStage(env.DB, stage.id, name);
    await room.configure({ ...metaOf(stage), name });
    return { ok: true as const };
  }
  if (intent === "rotate-output") {
    await rotateOutputToken(env.DB, stage.id);
    // Old OBS URLs stop at once. (The invite link is the stage id itself and
    // cannot be reissued.)
    await room.revoke("output");
    return { ok: true as const };
  }
  if (intent === "delete") {
    await deleteStage(env.DB, stage.id);
    await room.destroy();
    return redirect("/");
  }
  return data({ ok: false as const, error: "intent" }, { status: 400 });
}
