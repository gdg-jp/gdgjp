import { Alert, Icons, PageHeader, Stack, Text, Link as UiLink } from "@gdgjp/design-system";
import { Link as RouterLink, redirect } from "react-router";
import { buildSignInRedirect } from "~/features/auth/access.server";
import {
  ClaimsUnavailableError,
  type UserChapter,
  fetchChaptersForUser,
} from "~/features/auth/chapter.server";
import type { ChapterSummary } from "~/features/directory/directory";
import { fetchChaptersDirectory } from "~/features/directory/directory.server";
import { getGoogleConnectionSummary } from "~/features/google/oauth.server";
import { requireMeetingEditAccess } from "~/features/meetings/access.server";
import { MeetingForm } from "~/features/meetings/components/MeetingForm";
import { inviteSourcesToFormDefaults } from "~/features/meetings/form";
import { utcIsoToLocalDateTime } from "~/features/meetings/meeting";
import { listMeetingInviteSources } from "~/features/meetings/meetings.repository.server";
import {
  previewEditMeetingInvitees,
  updateMeeting,
} from "~/features/meetings/update-meeting.server";
import { AppLayout } from "~/layouts/AppLayout";
import type { Route } from "./+types/edit";

export function meta({ data }: Route.MetaArgs) {
  const title = data?.meeting?.title;
  return [{ title: title ? `${title} を編集 — GDG Japan Meet` : "会議を編集 — GDG Japan Meet" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const meetingId = params.id;
  if (!meetingId) {
    throw new Response("Not Found", { status: 404 });
  }

  const { user, meeting } = await requireMeetingEditAccess(env, request, meetingId);
  const [googleConnection, directoryChapters, sources] = await Promise.all([
    getGoogleConnectionSummary(env.DB),
    fetchChaptersDirectory(env).catch((): ChapterSummary[] => []),
    listMeetingInviteSources(env.DB, meetingId),
  ]);

  const hostChapterName =
    directoryChapters.find((c) => c.id === meeting.hostChapterId)?.name ??
    `チャプター #${meeting.hostChapterId}`;
  const startLocal = utcIsoToLocalDateTime(meeting.startAt, meeting.timeZone);
  const endLocal = utcIsoToLocalDateTime(meeting.endAt, meeting.timeZone);
  const inviteDefaults = inviteSourcesToFormDefaults(sources);

  return {
    user: {
      name: user.name,
      email: user.email,
      image: user.image,
      isAdmin: user.isAdmin,
    },
    accountsUrl: env.ACCOUNTS_URL,
    googleConnectionStatus: googleConnection.status,
    allChapters: directoryChapters,
    meeting: {
      id: meeting.id,
      title: meeting.title,
      description: meeting.description,
      hostChapterId: meeting.hostChapterId,
      hostChapterName,
      date: startLocal.date,
      startTime: startLocal.time,
      endTime: endLocal.time,
      timeZone: meeting.timeZone,
      accessType: meeting.accessType,
      autoTranscription: meeting.autoTranscription,
      autoSmartNotes: meeting.autoSmartNotes,
      autoRecording: meeting.autoRecording,
    },
    inviteDefaults,
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const meetingId = params.id;
  if (!meetingId) {
    throw new Response("Not Found", { status: 404 });
  }

  const { user, meeting, invitees } = await requireMeetingEditAccess(env, request, meetingId);
  let chapters: UserChapter[] = [];
  try {
    const resolved = await fetchChaptersForUser(env, request);
    chapters = resolved.all;
  } catch (err) {
    if (err instanceof ClaimsUnavailableError) throw buildSignInRedirect(request);
    throw err;
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "update");
  const actor = { user, chapters };

  if (intent === "preview") {
    const preview = await previewEditMeetingInvitees(env, actor, meeting, invitees, formData);
    return { intent: "preview" as const, preview };
  }

  const existingSources = await listMeetingInviteSources(env.DB, meetingId);
  const result = await updateMeeting(env, actor, meeting, existingSources, invitees, formData);
  if (result.ok) {
    return redirect(`/meetings/${meeting.id}?updated=1`);
  }
  return {
    intent: "update" as const,
    fieldErrors: result.fieldErrors ?? {},
    formError: result.formError,
  };
}

export default function EditMeeting({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, googleConnectionStatus, allChapters, meeting, inviteDefaults } =
    loaderData;
  const updateAction = actionData && actionData.intent === "update" ? actionData : undefined;

  return (
    <AppLayout user={user} accountsUrl={accountsUrl}>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader
          title="会議を編集"
          description={meeting.title}
          back={
            <UiLink asChild>
              <RouterLink to={`/meetings/${meeting.id}`} className="inline-flex items-center gap-1">
                <Icons name="ArrowLeft" size={16} aria-hidden="true" />
                会議詳細へ戻る
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
              ? "トークンの失効により、会議を更新できない状態です。管理者が再接続するまでお待ちください。"
              : "管理者が共有 Google ホストアカウントを接続するまで、会議を更新できません。"}
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

        <Alert tone="info" title="編集時のご注意">
          <Stack>
            <Text size="sm">
              会議中に共同主催者（co-host）に追加された人は、会議に入り直すとホスト管理が使えます。
            </Text>
            <Text size="sm">
              変更を保存すると Google
              カレンダーの予定が上書きされ、招待者へ更新通知メールが送信されます。招待者を外しても、既に共有済みの
              Google ドライブファイルの閲覧権限は自動では剥奪されません。
            </Text>
          </Stack>
        </Alert>

        <MeetingForm
          mode="edit"
          primaryChapterId={meeting.hostChapterId}
          hostChapterName={meeting.hostChapterName}
          allChapters={allChapters}
          defaultTitle={meeting.title}
          defaultDescription={meeting.description}
          defaultDate={meeting.date}
          defaultStartTime={meeting.startTime}
          defaultEndTime={meeting.endTime}
          defaultTimeZone={meeting.timeZone}
          defaultAccessType={meeting.accessType}
          defaultAutoArtifacts={{
            autoTranscription: meeting.autoTranscription,
            autoSmartNotes: meeting.autoSmartNotes,
            autoRecording: meeting.autoRecording,
          }}
          defaultIncludeHostOrganizers={inviteDefaults.includeHostOrganizers}
          defaultAdditionalChapters={inviteDefaults.additionalChapters}
          defaultCohostEmails={inviteDefaults.cohostEmails}
          defaultParticipantEmails={inviteDefaults.participantEmails}
          cancelTo={`/meetings/${meeting.id}`}
          canSubmit={googleConnectionStatus === "connected"}
          fieldErrors={updateAction?.fieldErrors}
          formError={updateAction?.formError}
        />
      </Stack>
    </AppLayout>
  );
}
