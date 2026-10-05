import { redirect } from "react-router";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { EventForm } from "~/features/events/components/EventForm";
import { createEvent } from "~/features/events/events.server";
import { regenerateTimeSlots } from "~/features/schedule/schedule.server";
import { isValidTime } from "~/features/schedule/slots";
import { createTrack } from "~/features/schedule/tracks.server";
import { getDb } from "~/lib/db.server";
import type { Route } from "./+types/events.new";

export function meta() {
  return [{ title: "イベント作成 — roster" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { chapters } = await requireUserWithChapter(env, request);
  return { chapters };
}

/**
 * Creates the event, its initial time-slot grid (no phases yet), and a
 * single shared "全体" track (docs/roster/index.md §3 "トラック") — all
 * three must exist before `/e/:id/design` first renders
 * (docs/roster/02-domain-schema.md "Verification" #2).
 */
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, request);
  const form = await request.formData();

  const name = String(form.get("name") ?? "").trim();
  const date = String(form.get("date") ?? "");
  const startTime = String(form.get("startTime") ?? "");
  const endTime = String(form.get("endTime") ?? "");
  const stepMin = Number.parseInt(String(form.get("stepMin") ?? ""), 10);
  const chapterId = Number.parseInt(String(form.get("chapterId") ?? ""), 10);
  const chapter = chapters.find((c) => c.chapterId === chapterId);

  if (!name) return { error: "イベント名を入力してください。" };
  if (!date) return { error: "開催日を選択してください。" };
  if (!isValidTime(startTime) || !isValidTime(endTime) || startTime >= endTime) {
    return { error: "開始時刻は終了時刻より前にしてください。" };
  }
  if (![15, 30, 60].includes(stepMin)) return { error: "刻み幅が不正です。" };
  if (!chapter) return { error: "チャプターを選択してください。" };

  const db = getDb(env);
  const event = await createEvent(db, {
    chapterId: chapter.chapterId,
    name,
    date,
    startTime,
    endTime,
    stepMin,
    createdBy: user.id,
  });
  await regenerateTimeSlots(db, event.id, { start: startTime, end: endTime, stepMin }, []);
  await createTrack(db, event.id, { name: "全体", color: "#4285f4", shared: true });

  return redirect(`/e/${event.id}/design`);
}

export default function NewEvent({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main className="admin-page admin-page-narrow">
      <div className="page-heading">
        <div>
          <h1>イベントを作成</h1>
          <p>基本情報を入力すると、時間枠と全体トラックを自動で準備します。</p>
        </div>
      </div>
      <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <EventForm chapters={loaderData.chapters} error={actionData?.error} />
      </section>
    </main>
  );
}
