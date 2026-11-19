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
import { Link as RouterLink } from "react-router";
import { fetchChaptersDirectory } from "~/features/directory/directory.server";
import { requireMeetingViewAccess, toPublicInviteeList } from "~/features/meetings/access.server";
import { InviteeListCard } from "~/features/meetings/components/InviteeListCard";
import {
  MEETING_ACCESS_TYPE_OPTIONS,
  MEETING_STATUS_META,
  formatMeetingDateTimeRange,
} from "~/features/meetings/meeting";
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
  const directoryChapters = await fetchChaptersDirectory(env).catch(() => []);
  const hostChapterName =
    directoryChapters.find((c) => c.id === meeting.hostChapterId)?.name ??
    `チャプター #${meeting.hostChapterId}`;

  return {
    user: {
      name: user.name,
      email: user.email,
      image: user.image,
      isAdmin: user.isAdmin,
    },
    accountsUrl: env.ACCOUNTS_URL,
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
      hostChapterName,
    },
    invitees: toPublicInviteeList(invitees),
  };
}

export default function MeetingDetail({ loaderData }: Route.ComponentProps) {
  const { user, accountsUrl, meeting, invitees } = loaderData;
  const statusMeta = MEETING_STATUS_META[meeting.status];
  const accessMeta = MEETING_ACCESS_TYPE_OPTIONS.find((opt) => opt.value === meeting.accessType);
  const schedule = formatMeetingDateTimeRange(meeting.startAt, meeting.endAt, meeting.timeZone);

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

        <Card>
          <Stack>
            <Heading level={2}>会議情報</Heading>

            {(meeting.meetingUri || meeting.calendarHtmlLink) && (
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
                  会議中に共同主催者（co-host）へ追加された方は、一度退室して入り直すとホスト管理が利用できます。
                </Text>
                <Text size="sm">
                  招待メールが「不明な送信者からの招待」となり Google
                  カレンダーに予定が自動で追加されない場合は、招待メールで出欠を「はい」と返信すると追加されます。送信者（community-support@gdgoc.jp）を連絡先に追加すると、以降の招待は自動で追加されます。
                </Text>
              </Stack>
            </Alert>
          </Stack>
        </Card>

        <InviteeListCard invitees={invitees} />
      </Stack>
    </AppLayout>
  );
}
