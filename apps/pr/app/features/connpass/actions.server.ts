import type { CampaignAccess } from "~/features/campaigns/access.server";
import { actorOf, connpassService } from "~/features/integrations/bindings.server";
import { adoptedPlan } from "~/features/plans/plan.repository.server";
import { constants } from "~/features/playbook/playbook";
import { createItem, listItems, updateItem } from "~/features/schedule/item.repository.server";
import { NO_EVENT, connpassEventOf, submitConnpass } from "./submit.server";
import { surveyFromPlan } from "./survey";

type Result = { ok: true; message: string } | { ok: false; error: string };
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);
export const MAX_IMAGE_BYTES = 1024 * 1024;
const now = () => Math.floor(Date.now() / 1000);

/** An item for what a person just did on connpass, tracked until its job finishes. */
async function trackedItem(
  env: Env,
  access: CampaignAccess,
  kind: "connpass_subevent" | "connpass_publish" | "connpass_update",
  title: string,
) {
  const open = (await listItems(env.DB, access.campaign.id)).find(
    (i) => i.kind === kind && i.title === title && i.status !== "done" && i.status !== "skipped",
  );
  return (
    open?.id ??
    createItem(
      env.DB,
      access.campaign.id,
      { kind, dueAt: now(), title, requiresApproval: false },
      null,
      {
        derive: false,
      },
    )
  );
}

async function run(
  env: Env,
  access: CampaignAccess,
  kind: Parameters<typeof submitConnpass>[1]["kind"],
  item: {
    kind: "connpass_subevent" | "connpass_publish" | "connpass_update";
    title: string;
  } | null,
  call: (event: { groupSlug: string; eventId: string }) => ReturnType<
    Parameters<typeof submitConnpass>[1]["call"]
  >,
  done: string,
): Promise<Result> {
  const event = connpassEventOf(access.campaign);
  if (!event) return { ok: false, error: NO_EVENT };
  const itemId = item ? await trackedItem(env, access, item.kind, item.title) : null;
  const result = await submitConnpass(env, {
    actor: actorOf(access),
    campaign: access.campaign,
    itemId,
    kind,
    call: () => call(event),
  });
  if (itemId)
    await updateItem(env.DB, access.campaign.id, itemId, {
      status: result.ok ? "scheduled" : "failed",
      externalRef: result.ok ? { connpassJobId: result.job.id } : null,
    });
  return result.ok
    ? { ok: true, message: `${done}（connpass ジョブ ${result.job.id}）` }
    : { ok: false, error: result.error };
}

/** 計画画面「アンケートを反映」: the plan's survey, with channel labels as the source options. */
export async function applySurvey(env: Env, access: CampaignAccess): Promise<Result> {
  const plan = await adoptedPlan(env.DB, access.campaign.id);
  if (!plan) return { ok: false, error: "計画を採用してから反映してください" };
  const survey = surveyFromPlan(plan.body, constants);
  if (!survey.ok) return survey;
  const actor = actorOf(access);
  return run(
    env,
    access,
    "upsert_survey",
    null,
    (event) => connpassService(env).upsertSurvey({ actor, ...event, questions: survey.questions }),
    "アンケートを反映するジョブを積みました",
  );
}

/** A sub-event (座談会・ハンズオンの申込枠) from the plan's segment ideas or a person's title. */
export async function createSubEvent(
  env: Env,
  access: CampaignAccess,
  title: string,
): Promise<Result> {
  if (!title.trim()) return { ok: false, error: "サブイベントの名前を入れてください" };
  const actor = actorOf(access);
  return run(
    env,
    access,
    "create_sub_event",
    { kind: "connpass_subevent", title: title.trim() },
    (event) => connpassService(env).createSubEvent({ actor, ...event, title: title.trim() }),
    "サブイベントを作るジョブを積みました",
  );
}

/** The thumbnail a person uploads (Stage 06 generates them): PNG / JPEG / GIF, 1 MB or less. */
export async function uploadThumbnail(
  env: Env,
  access: CampaignAccess,
  file: File | null,
): Promise<Result> {
  if (!file || !IMAGE_TYPES.has(file.type))
    return { ok: false, error: "PNG / JPEG / GIF の画像を選んでください" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "connpass の画像は 1 MB までです" };
  const actor = actorOf(access);
  const bytes = await file.arrayBuffer();
  return run(
    env,
    access,
    "upload_event_image",
    null,
    (event) =>
      connpassService(env).uploadImage({
        actor,
        ...event,
        bytes,
        contentType: file.type,
        name: file.name,
      }),
    "サムネイルを上げるジョブを積みました",
  );
}

/** 「公開」: the connpass event goes public (a person confirms first). */
export async function publishEvent(
  env: Env,
  access: CampaignAccess,
  confirmed: boolean,
): Promise<Result> {
  if (!confirmed) return { ok: false, error: "公開してよいことを確認してください" };
  const actor = actorOf(access);
  return run(
    env,
    access,
    "publish_event",
    { kind: "connpass_publish", title: "connpass を公開" },
    (event) => connpassService(env).publishEvent({ actor, ...event }),
    "公開するジョブを積みました",
  );
}
