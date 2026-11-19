import {
  Alert,
  Badge,
  Button,
  Card,
  Heading,
  Icons,
  Inline,
  PageHeader,
  Separator,
  Stack,
  Text,
  TypographyInlineCode,
  Link as UiLink,
} from "@gdgjp/design-system";
import { Link as RouterLink, useNavigation } from "react-router";
import { toPublicArtifact } from "~/features/artifacts/artifact";
import { ArtifactList } from "~/features/artifacts/components/ArtifactList";
import { listArtifactsByMeetingId } from "~/features/artifacts/repository.server";
import { buildSignInRedirect } from "~/features/auth/access.server";
import {
  ClaimsUnavailableError,
  type UserChapter,
  fetchChaptersForUser,
} from "~/features/auth/chapter.server";
import { fetchChaptersDirectory } from "~/features/directory/directory.server";
import { getGoogleConnectionSummary } from "~/features/google/oauth.server";
import {
  canEditMeeting,
  requireMeetingEditAccess,
  requireMeetingViewAccess,
  toPublicInviteeList,
} from "~/features/meetings/access.server";
import { cancelMeeting } from "~/features/meetings/cancel-meeting.server";
import { InviteeListCard } from "~/features/meetings/components/InviteeListCard";
import { MeetingDetailActions } from "~/features/meetings/components/MeetingDetailActions";
import {
  MEETING_ACCESS_TYPE_OPTIONS,
  MEETING_STATUS_META,
  formatMeetingDateTimeRange,
} from "~/features/meetings/meeting";
import { listMeetingInviteSources } from "~/features/meetings/meetings.repository.server";
import { resyncMeetingInvitees } from "~/features/meetings/update-meeting.server";
import { AppLayout } from "~/layouts/AppLayout";
import type { Route } from "./+types/detail";

export function meta({ data }: Route.MetaArgs) {
  const title = data?.meeting?.title;
  return [{ title: title ? `${title} — GDG Japan Meet` : "会議詳細 — GDG Japan Meet" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const meetingId = params.id;
  if (!meetingId) {
    throw new Response("Not Found", { status: 404 });
  }

  const { user, meeting, invitees } = await requireMeetingViewAccess(env, request, meetingId);
  const [directoryChapters, googleConnection, artifacts] = await Promise.all([
    fetchChaptersDirectory(env).catch(() => []),
    getGoogleConnectionSummary(env.DB),
    listArtifactsByMeetingId(env.DB, meetingId),
  ]);
  const hostChapterName =
    directoryChapters.find((c) => c.id === meeting.hostChapterId)?.name ??
    `チャプター #${meeting.hostChapterId}`;
  const url = new URL(request.url);

  return {
    user: {
      name: user.name,
      email: user.email,
      image: user.image,
      isAdmin: user.isAdmin,
    },
    accountsUrl: env.ACCOUNTS_URL,
    canEdit: canEditMeeting(user, meeting, invitees),
    googleConnectionStatus: googleConnection.status,
    flashUpdated: url.searchParams.get("updated") === "1",
    meeting: {
      id: meeting.id,
      title: meeting.title,
      description: meeting.description,
      startAt: meeting.startAt,
      endAt: meeting.endAt,
      timeZone: meeting.timeZone,
      accessType: meeting.accessType,
      meetingUri: meeting.meetingUri,
      meetingCode: meeting.meetingCode,
      calendarHtmlLink: meeting.calendarHtmlLink,
      status: meeting.status,
      lastError: meeting.lastError,
      canceledAt: meeting.canceledAt,
      hostChapterName,
    },
    invitees: toPublicInviteeList(invitees),
    artifacts: artifacts.map(toPublicArtifact),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const meetingId = params.id;
  if (!meetingId) {
    throw new Response("Not Found", { status: 404 });
  }

  const { user, meeting, invitees } = await requireMeetingEditAccess(env, request, meetingId);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "resync") {
    let chapters: UserChapter[] = [];
    try {
      const resolved = await fetchChaptersForUser(env, request);
      chapters = resolved.all;
    } catch (err) {
      if (err instanceof ClaimsUnavailableError) throw buildSignInRedirect(request);
      throw err;
    }

    const sources = await listMeetingInviteSources(env.DB, meetingId);
    const result = await resyncMeetingInvitees(env, { user, chapters }, meeting, sources, invitees);
    return { intent: "resync" as const, result };
  }

  if (intent === "cancel") {
    const result = await cancelMeeting(env, meeting);
    return { intent: "cancel" as const, result };
  }

  throw new Response("Bad Request", { status: 400 });
}

export default function MeetingDetail({ loaderData, actionData }: Route.ComponentProps) {
  const {
    user,
    accountsUrl,
    canEdit,
    googleConnectionStatus,
    flashUpdated,
    meeting,
    invitees,
    artifacts,
  } = loaderData;
  const navigation = useNavigation();
  const submittingIntent =
    navigation.state === "submitting" ? String(navigation.formData?.get("intent") ?? "") : "";
  const isResyncing = submittingIntent === "resync";
  const isCanceling = submittingIntent === "cancel";

  const statusMeta = MEETING_STATUS_META[meeting.status];
  const accessMeta = MEETING_ACCESS_TYPE_OPTIONS.find((opt) => opt.value === meeting.accessType);
  const schedule = formatMeetingDateTimeRange(meeting.startAt, meeting.endAt, meeting.timeZone);
  const resyncAction = actionData && actionData.intent === "resync" ? actionData : undefined;
  const cancelAction = actionData && actionData.intent === "cancel" ? actionData : undefined;

  return (
    <AppLayout user={user} accountsUrl={accountsUrl}>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader
          title={meeting.title}
          back={
            <UiLink asChild>
              <RouterLink to="/" className="inline-flex items-center gap-1">
                <Icons name="ArrowLeft" size={16} aria-hidden="true" />
                会議一覧へ戻る
              </RouterLink>
            </UiLink>
          }
          actions={<Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>}
        />

        {flashUpdated && (
          <Alert tone="success" title="会議を更新しました">
            Google カレンダーの予定を更新し、招待者へ更新通知メールを送信しました。
          </Alert>
        )}

        {resyncAction?.result.ok && (
          <Alert tone="success" title="チャプターから再同期しました">
            再同期しました（招待者 {resyncAction.result.totalCount} 名、
            {resyncAction.result.changed ? "変更あり" : "変更なし"}）
          </Alert>
        )}

        {resyncAction && !resyncAction.result.ok && (
          <Alert tone="danger" title="チャプターからの再同期に失敗しました">
            {resyncAction.result.error}
          </Alert>
        )}

        {cancelAction?.result.ok && (
          <Alert tone="success" title="会議を取り消しました">
            Google カレンダーの予定を削除し、Meet スペースのクリーンアップを開始しました。
          </Alert>
        )}

        {cancelAction && !cancelAction.result.ok && (
          <Alert tone="danger" title="会議の取り消しに失敗しました">
            {cancelAction.result.error}
          </Alert>
        )}

        {meeting.status === "canceled" && (
          <Alert tone="info" title="この会議は取り消し済みです">
            Google カレンダーの予定は削除されており、編集・再同期・再取り消しはできません。Meet
            スペースの登録メンバーはバックグラウンドで削除され、アクセス設定は「制限付き」へ戻ります。
          </Alert>
        )}

        {meeting.status === "failed" && (
          <Alert tone="danger" title="会議の作成に失敗しました">
            {meeting.lastError ??
              "Google API の呼び出し中にエラーが発生したため、会議の作成が完了しませんでした。"}
          </Alert>
        )}

        {meeting.status === "creating" && (
          <Alert tone="info" title="会議を作成しています">
            処理完了までしばらくお待ちください。数秒後に再読み込みしてください。
          </Alert>
        )}

        {meeting.status === "active" && meeting.lastError && (
          <Alert tone="warning" title="メンバー同期でエラーまたは警告が発生しました">
            {meeting.lastError}
          </Alert>
        )}

        {canEdit && googleConnectionStatus !== "connected" && (
          <Alert
            tone={googleConnectionStatus === "disconnected" ? "danger" : "warning"}
            title={
              googleConnectionStatus === "disconnected"
                ? "共有 Google アカウントの接続が切断されています"
                : "共有 Google アカウントが未接続です"
            }
          >
            共有 Google アカウントが接続されるまで、会議の編集・再同期・取り消しを実行できません。
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

        <Card>
          <Stack>
            <Inline className="items-center justify-between">
              <Heading level={2}>会議情報</Heading>
              {canEdit && (
                <MeetingDetailActions
                  meetingId={meeting.id}
                  meetingTitle={meeting.title}
                  canMutateGoogle={googleConnectionStatus === "connected"}
                  isResyncing={isResyncing}
                  isCanceling={isCanceling}
                />
              )}
            </Inline>

            {meeting.status !== "canceled" && (meeting.meetingUri || meeting.calendarHtmlLink) && (
              <Inline>
                {meeting.meetingUri && (
                  <Button asChild>
                    <a href={meeting.meetingUri} target="_blank" rel="noopener noreferrer">
                      <Icons name="ExternalLink" size={16} aria-hidden="true" />
                      Google Meet に参加
                    </a>
                  </Button>
                )}
                {meeting.calendarHtmlLink && (
                  <Button variant="outline" asChild>
                    <a href={meeting.calendarHtmlLink} target="_blank" rel="noopener noreferrer">
                      <Icons name="CalendarDays" size={16} aria-hidden="true" />
                      Google カレンダーで開く
                    </a>
                  </Button>
                )}
              </Inline>
            )}

            <Separator />

            <dl className="grid gap-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
              <dt className="font-semibold text-muted">日時</dt>
              <dd className="min-w-0">
                {schedule}（{meeting.timeZone}）
              </dd>

              <dt className="font-semibold text-muted">主催チャプター</dt>
              <dd className="min-w-0">{meeting.hostChapterName}</dd>

              <dt className="font-semibold text-muted">アクセスの種類</dt>
              <dd className="min-w-0">
                <div>{accessMeta?.label ?? meeting.accessType}</div>
                {accessMeta && (
                  <Text tone="muted" size="sm">
                    {accessMeta.description}
                  </Text>
                )}
              </dd>

              {meeting.meetingUri && (
                <>
                  <dt className="font-semibold text-muted">Meet URL</dt>
                  <dd className="min-w-0 break-all">
                    <UiLink href={meeting.meetingUri} target="_blank" rel="noopener noreferrer">
                      {meeting.meetingUri}
                    </UiLink>
                  </dd>
                </>
              )}

              {meeting.meetingCode && (
                <>
                  <dt className="font-semibold text-muted">会議コード</dt>
                  <dd className="min-w-0">
                    <TypographyInlineCode>{meeting.meetingCode}</TypographyInlineCode>
                  </dd>
                </>
              )}

              {meeting.description && (
                <>
                  <dt className="font-semibold text-muted">説明</dt>
                  <dd className="min-w-0 whitespace-pre-wrap break-words">{meeting.description}</dd>
                </>
              )}
            </dl>

            <Separator />

            <Alert tone="info" title="ご利用上の注意">
              <Stack>
                <Text size="sm">
                  Google Meet
                  のチャット履歴は自動保存されません。残したい内容は会議中に別途メモしてください。
                </Text>
                <Text size="sm">
                  会議中に共同主催者（co-host）に追加された人は、会議に入り直すとホスト管理が使えます。
                </Text>
                <Text size="sm">
                  招待者を後から外した場合でも、既に共有済みの Google
                  ドライブファイルの閲覧権限は自動では剥奪されません。
                </Text>
                <Text size="sm">
                  Google
                  カレンダー上で直接加えた変更は取り込まれません。このアプリから編集すると内容が上書きされます。
                </Text>
                <Text size="sm">
                  招待メールが「不明な送信者からの招待」となり Google
                  カレンダーに予定が自動で追加されない場合は、招待メールで出欠を「はい」と返信すると追加されます。送信者（community-support@gdgoc.jp）を連絡先に追加すると、以降の招待は自動で追加されます。
                </Text>
              </Stack>
            </Alert>
          </Stack>
        </Card>

        <ArtifactList artifacts={artifacts} />

        <InviteeListCard invitees={invitees} />
      </Stack>
    </AppLayout>
  );
}
