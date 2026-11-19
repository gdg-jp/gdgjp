import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Heading,
  Icons,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  PageHeader,
  Stack,
  Text,
  Link as UiLink,
} from "@gdgjp/design-system";
import { Link as RouterLink } from "react-router";
import { GoogleWorkspaceLogo } from "~/components/GoogleWorkspaceLogo";
import { buildSignInRedirect, requireUser } from "~/features/auth/access.server";
import { ClaimsUnavailableError, fetchChaptersForUser } from "~/features/auth/chapter.server";
import { fetchChaptersDirectory } from "~/features/directory/directory.server";
import { normalizeEmail } from "~/features/google/email";
import { getGoogleConnectionSummary } from "~/features/google/oauth.server";
import {
  MEETING_STATUS_META,
  type MeetingListItem,
  formatMeetingDateTimeRange,
  splitMeetingsByTime,
} from "~/features/meetings/meeting";
import { listVisibleMeetings } from "~/features/meetings/meetings.repository.server";
import { AppLayout } from "~/layouts/AppLayout";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "会議一覧 — GDG Japan Meet" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(env, request);
  let hasChapter = false;
  try {
    const resolved = await fetchChaptersForUser(env, request);
    hasChapter = resolved.all.length > 0;
  } catch (err) {
    if (err instanceof ClaimsUnavailableError) throw buildSignInRedirect(request);
    throw err;
  }

  const [googleConnection, visibleMeetings, chapterDirectory] = await Promise.all([
    getGoogleConnectionSummary(env.DB),
    listVisibleMeetings(env.DB, {
      userId: user.id,
      emailNormalized: normalizeEmail(user.email),
      isAdmin: Boolean(user.isAdmin),
    }),
    fetchChaptersDirectory(env).catch(() => []),
  ]);

  const chapterNames = Object.fromEntries(
    chapterDirectory.map((chapter) => [chapter.id, chapter.name]),
  );
  const { upcoming, past } = splitMeetingsByTime(visibleMeetings);

  return {
    user: {
      name: user.name,
      email: user.email,
      image: user.image,
      isAdmin: user.isAdmin,
    },
    accountsUrl: env.ACCOUNTS_URL,
    hasChapter,
    googleConnectionStatus: googleConnection.status,
    chapterNames,
    upcomingMeetings: upcoming,
    pastMeetings: past,
  };
}

function MeetingRow({
  meeting,
  chapterName,
}: {
  meeting: MeetingListItem;
  chapterName: string;
}) {
  const statusMeta = MEETING_STATUS_META[meeting.status];
  const schedule = formatMeetingDateTimeRange(meeting.startAt, meeting.endAt, meeting.timeZone);
  return (
    <Item variant="outline" className="relative">
      <ItemMedia>
        <GoogleWorkspaceLogo brand="calendar" size={20} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          <RouterLink to={`/meetings/${meeting.id}`} className="after:absolute after:inset-0">
            {meeting.title}
          </RouterLink>
        </ItemTitle>
        <ItemDescription>
          {schedule}（{meeting.timeZone}） · {chapterName}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
      </ItemActions>
    </Item>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const {
    user,
    accountsUrl,
    hasChapter,
    googleConnectionStatus,
    chapterNames,
    upcomingMeetings,
    pastMeetings,
  } = loaderData;

  const hasAnyMeetings = upcomingMeetings.length > 0 || pastMeetings.length > 0;
  const resolveChapterName = (chapterId: number) =>
    chapterNames[chapterId] ?? `チャプター #${chapterId}`;

  return (
    <AppLayout user={user} accountsUrl={accountsUrl}>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader
          title="GDG Japan Meet"
          actions={
            hasChapter ? (
              <Button asChild>
                <RouterLink to="/meetings/new">
                  <Icons name="Plus" size={16} aria-hidden="true" />
                  新しい会議
                </RouterLink>
              </Button>
            ) : undefined
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
              ? "トークンの失効により、会議の作成・更新ができない状態です。管理者が再接続するまでお待ちください。"
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

        {!hasAnyMeetings ? (
          <Card>
            <EmptyState
              title="まだ会議がありません"
              description="作成または招待された Google Meet 会議がここに表示されます。"
            />
          </Card>
        ) : (
          <Stack>
            <section>
              <Stack>
                <Heading level={2}>今後の会議</Heading>
                {upcomingMeetings.length === 0 ? (
                  <Card>
                    <Text tone="muted" size="sm">
                      予定されている今後の会議はありません。
                    </Text>
                  </Card>
                ) : (
                  <ItemGroup>
                    {upcomingMeetings.map((meeting) => (
                      <MeetingRow
                        key={meeting.id}
                        meeting={meeting}
                        chapterName={resolveChapterName(meeting.hostChapterId)}
                      />
                    ))}
                  </ItemGroup>
                )}
              </Stack>
            </section>

            {pastMeetings.length > 0 && (
              <section>
                <Stack>
                  <Heading level={2}>過去の会議</Heading>
                  <ItemGroup>
                    {pastMeetings.map((meeting) => (
                      <MeetingRow
                        key={meeting.id}
                        meeting={meeting}
                        chapterName={resolveChapterName(meeting.hostChapterId)}
                      />
                    ))}
                  </ItemGroup>
                </Stack>
              </section>
            )}
          </Stack>
        )}
      </Stack>
    </AppLayout>
  );
}
