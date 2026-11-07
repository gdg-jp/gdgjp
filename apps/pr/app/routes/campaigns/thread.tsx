import { useEffect } from "react";
import { useRevalidator } from "react-router";
import { runAction } from "~/features/assistant/actions.server";
import { Composer } from "~/features/assistant/components/Composer";
import { StatusPanel } from "~/features/assistant/components/StatusPanel";
import { Thread } from "~/features/assistant/components/Thread";
import {
  getMessage,
  listMessages,
  setActions,
} from "~/features/assistant/message.repository.server";
import { postMessage, refreshSource, removeSource } from "~/features/assistant/post.server";
import { listSources } from "~/features/assistant/source.repository.server";
import { campaignState } from "~/features/assistant/state.server";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import { campaignNotices } from "~/features/notifications/notifications.server";
import { CampaignLayout } from "~/layouts/CampaignLayout";
import type { Route } from "./+types/thread";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.campaign.name ?? "イベント"} — GDG PR` }];
}

/** An event's home: the thread with the assistant, and where things stand. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const { campaign } = access;
  const [messages, sources, { state }, notices] = await Promise.all([
    listMessages(env.DB, campaign.id, 100),
    listSources(env.DB, campaign.id),
    campaignState(env, campaign),
    campaignNotices(env, campaign, {
      userId: access.user.id,
      chapterIds: access.chapters.map((c) => c.chapterId),
      organizer: access.permissions.manage,
    }),
  ]);
  return {
    campaign: { slug: campaign.slug, name: campaign.name, status: campaign.status },
    messages,
    sources,
    state,
    notices,
    thinking: state.jobs.some((j) => j.type === "assist"),
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "message") return postMessage(env, access, form);
  if (intent === "refresh-source") return refreshSource(env, access, Number(form.get("source")));
  if (intent === "remove-source") {
    await removeSource(env, access, Number(form.get("source")));
    return { ok: true as const };
  }
  if (intent === "action" || intent === "dismiss") {
    const message = await getMessage(env.DB, access.campaign.id, Number(form.get("message")));
    const index = Number(form.get("index"));
    const target = message?.actions[index];
    if (!message || !target || target.status !== "proposed")
      return { ok: false as const, error: "このボタンはもう使えません" };
    const next =
      intent === "dismiss"
        ? { ...target, status: "dismissed" as const }
        : await runAction(env, access.campaign, target, {
            userId: access.user.id,
            canManage: access.permissions.manage,
            members: access.members,
          });
    await setActions(
      env.DB,
      access.campaign.id,
      message.id,
      message.actions.map((a, i) => (i === index ? next : a)),
    );
    return next.status === "failed"
      ? { ok: false as const, error: next.result ?? "できませんでした" }
      : { ok: true as const };
  }
  return { ok: false as const, error: "不明な操作です" };
}

export default function CampaignThread({ loaderData }: Route.ComponentProps) {
  const { campaign, messages, sources, state, notices, thinking } = loaderData;
  const revalidator = useRevalidator();
  const busy = state.jobs.length > 0;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 5_000);
    return () => clearInterval(timer);
  }, [busy, revalidator]);
  const base = `/c/${campaign.slug}`;
  return (
    <CampaignLayout campaign={campaign} title="">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="flex min-w-0 flex-col gap-4" aria-label="秘書とのスレッド">
          <Thread messages={messages} base={base} thinking={thinking} />
          <Composer />
        </section>
        <aside aria-label="いまの状態">
          <StatusPanel state={state} notices={notices} sources={sources} />
        </aside>
      </div>
    </CampaignLayout>
  );
}
