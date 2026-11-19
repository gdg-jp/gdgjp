import { Alert, Icons, PageHeader, Stack, Link as UiLink } from "@gdgjp/design-system";
import { Link as RouterLink, redirect } from "react-router";
import { requireUserWithChapter } from "~/features/auth/access.server";
import type { ChapterSummary } from "~/features/directory/directory";
import { fetchChaptersDirectory } from "~/features/directory/directory.server";
import { getGoogleConnectionSummary } from "~/features/google/oauth.server";
import { MeetingForm } from "~/features/meetings/components/MeetingForm";
import { createMeeting, previewMeetingInvitees } from "~/features/meetings/create.server";
import { DEFAULT_TIME_ZONE, getDefaultMeetingSchedule } from "~/features/meetings/meeting";
import { AppLayout } from "~/layouts/AppLayout";
import type { Route } from "./+types/new";

export function meta() {
  return [{ title: "新しい会議を作成 — GDG Japan Meet" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, chapter, chapters } = await requireUserWithChapter(env, request);

  const [googleConnection, directoryChapters] = await Promise.all([
    getGoogleConnectionSummary(env.DB),
    fetchChaptersDirectory(env).catch((): ChapterSummary[] =>
      chapters.map((c) => ({
        id: c.chapterId,
        slug: c.chapterSlug,
        name: c.chapterSlug,
        kind: "",
        region: "",
      })),
    ),
  ]);

  const chapterNameById = new Map(directoryChapters.map((c) => [c.id, c.name]));
  const userChapters = chapters.map((c) => ({
    id: c.chapterId,
    slug: c.chapterSlug,
    name: chapterNameById.get(c.chapterId) ?? c.chapterSlug,
  }));
  const defaultSchedule = getDefaultMeetingSchedule(new Date(), DEFAULT_TIME_ZONE);

  return {
    user: {
      name: user.name,
      email: user.email,
      image: user.image,
      isAdmin: user.isAdmin,
    },
    accountsUrl: env.ACCOUNTS_URL,
    googleConnectionStatus: googleConnection.status,
    primaryChapterId: chapter.chapterId,
    userChapters,
    allChapters: directoryChapters,
    defaultDate: defaultSchedule.date,
    defaultStartTime: defaultSchedule.startTime,
    defaultEndTime: defaultSchedule.endTime,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "create");
  const actor = { user, chapters };

  if (intent === "preview") {
    const preview = await previewMeetingInvitees(env, actor, formData);
    return { intent: "preview" as const, preview };
  }

  const result = await createMeeting(env, actor, formData);
  if (result.ok) {
    return redirect(`/meetings/${result.meetingId}`);
  }
  if (result.meetingId) {
    return redirect(`/meetings/${result.meetingId}`);
  }
  return {
    intent: "create" as const,
    fieldErrors: result.fieldErrors ?? {},
    formError: result.formError,
  };
}

export default function NewMeeting({ loaderData, actionData }: Route.ComponentProps) {
  const {
    user,
    accountsUrl,
    googleConnectionStatus,
    primaryChapterId,
    userChapters,
    allChapters,
    defaultDate,
    defaultStartTime,
    defaultEndTime,
  } = loaderData;

  const createAction = actionData && actionData.intent === "create" ? actionData : undefined;

  return (
    <AppLayout user={user} accountsUrl={accountsUrl}>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader
          title="新しい会議を作成"
          description="共有ホストアカウントで Google Meet スペースとカレンダー予定を作成し、招待者を自動登録します。"
          back={
            <UiLink asChild>
              <RouterLink to="/" className="inline-flex items-center gap-1">
                <Icons name="ArrowLeft" size={16} aria-hidden="true" />
                会議一覧へ戻る
              </RouterLink>
            </UiLink>
          }
        />

        {googleConnectionStatus !== "connected" && (
          <Alert
            tone={googleConnectionStatus === "disconnected" ? "danger" : "warning"}
            title={
              googleConnectionStatus === "disconnected"
                ? "共有 Google アカウントの接続が切断されています"
                : "共有 Google アカウントが未接続です"
            }
          >
            {googleConnectionStatus === "disconnected"
              ? "トークンの失効により、会議を作成できない状態です。管理者が再接続するまでお待ちください。"
              : "管理者が共有 Google ホストアカウントを接続するまで、会議を作成できません。"}
            {user.isAdmin && (
              <>
                {" "}
                <UiLink asChild>
                  <RouterLink to="/admin/google">Google 接続設定を開く</RouterLink>
                </UiLink>
              </>
            )}
          </Alert>
        )}

        <MeetingForm
          userChapters={userChapters}
          primaryChapterId={primaryChapterId}
          allChapters={allChapters}
          defaultDate={defaultDate}
          defaultStartTime={defaultStartTime}
          defaultEndTime={defaultEndTime}
          canSubmit={googleConnectionStatus === "connected"}
          fieldErrors={createAction?.fieldErrors}
          formError={createAction?.formError}
        />
      </Stack>
    </AppLayout>
  );
}
