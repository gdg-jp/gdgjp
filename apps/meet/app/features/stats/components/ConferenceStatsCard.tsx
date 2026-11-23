import { Badge, Card, Heading, Inline, Separator, Stack, Table, Text } from "@gdgjp/design-system";
import {
  type ConferenceParticipantCategory,
  type ConferenceParticipantStatRow,
  type ConferenceStatsStatus,
  type ConferenceStatsView,
  formatConferencePeriod,
  formatDurationJa,
  formatStatsTime,
} from "../stats";

export type ConferenceStatsCardProps = {
  stats: readonly ConferenceStatsView[];
  timeZone: string;
};

const STATUS_META: Record<
  Exclude<ConferenceStatsStatus, "skipped">,
  { label: string; tone: "info" | "success" | "warning" }
> = {
  pending: { label: "集計待ち", tone: "info" },
  collecting: { label: "集計中", tone: "info" },
  collected: { label: "集計済み", tone: "success" },
  failed: { label: "集計失敗", tone: "warning" },
  expired: { label: "取得期限切れ", tone: "warning" },
};

const CATEGORY_META: Record<
  ConferenceParticipantCategory,
  { label: string; tone: "info" | "neutral" }
> = {
  cohost: { label: "共同主催者", tone: "info" },
  invitee: { label: "招待者", tone: "neutral" },
  non_invitee: { label: "招待外", tone: "neutral" },
  anonymous: { label: "匿名", tone: "neutral" },
  phone: { label: "電話", tone: "neutral" },
};

function resolveParticipantLabel(row: ConferenceParticipantStatRow): string {
  if (row.displayName) return row.displayName;
  if (row.maskedEmail) return row.maskedEmail;
  if (row.category === "anonymous") return "匿名参加者";
  if (row.category === "phone") return "電話参加者";
  return "名前未設定";
}

function ParticipantStatsTable({
  participants,
  timeZone,
}: {
  participants: readonly ConferenceParticipantStatRow[];
  timeZone: string;
}) {
  return (
    <Stack>
      <Table scrollLabel="個人別の参加状況テーブルを横にスクロール">
        <thead>
          <tr>
            <th scope="col">名前</th>
            <th scope="col">区分</th>
            <th scope="col">最初の入室</th>
            <th scope="col">最後の退室</th>
            <th scope="col">滞在時間</th>
            <th scope="col">入退室回数</th>
            <th scope="col">発言時間（参考値）</th>
          </tr>
        </thead>
        <tbody>
          {participants.map((row) => {
            const cat = CATEGORY_META[row.category];
            const showMaskedEmail = Boolean(row.displayName && row.maskedEmail);
            return (
              <tr key={row.key}>
                <td>
                  <div>{resolveParticipantLabel(row)}</div>
                  {showMaskedEmail && (
                    <Text tone="muted" size="sm">
                      {row.maskedEmail}
                    </Text>
                  )}
                </td>
                <td>
                  <Inline className="items-center">
                    <Badge tone={cat.tone}>{cat.label}</Badge>
                    {!row.attended && <Badge tone="neutral">未出席</Badge>}
                  </Inline>
                </td>
                <td>{row.attended ? formatStatsTime(row.earliestStartTime, timeZone) : "—"}</td>
                <td>{row.attended ? formatStatsTime(row.latestEndTime, timeZone) : "—"}</td>
                <td>{row.attended ? formatDurationJa(row.totalSeconds) : "—"}</td>
                <td>{row.attended ? `${row.sessionCount} 回` : "0 回"}</td>
                <td>
                  {row.speakingSeconds !== null
                    ? `${formatDurationJa(row.speakingSeconds)}（参考値）`
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Text tone="muted" size="sm">
        ※
        発言時間（参考値）は文字起こしの話者帰属に基づく参考値であり、正確な発話時間とは異なる場合があります。
      </Text>
    </Stack>
  );
}

export function ConferenceStatsCard({ stats, timeZone }: ConferenceStatsCardProps) {
  return (
    <Card>
      <Stack>
        <Inline className="items-center justify-between">
          <Heading level={2}>参加状況・会議統計</Heading>
          {stats.length > 0 && (
            <Text tone="muted" size="sm">
              {stats.length} 回
            </Text>
          )}
        </Inline>

        <Separator />

        {stats.length === 0 ? (
          <Text tone="muted" size="sm">
            会議の開催記録はまだありません。会議終了後に自動で集計されます。
          </Text>
        ) : (
          <Stack>
            {stats.map((record, index) => {
              const statusMeta = STATUS_META[record.statsStatus];
              const avgSeconds =
                record.participantCount !== null &&
                record.participantCount > 0 &&
                record.totalAttendanceSeconds !== null
                  ? Math.round(record.totalAttendanceSeconds / record.participantCount)
                  : null;

              return (
                <Stack key={record.name}>
                  {index > 0 && <Separator />}

                  <Inline className="items-center justify-between">
                    <Heading level={3}>
                      {formatConferencePeriod(record.startTime, record.endTime, timeZone)}
                    </Heading>
                    <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                  </Inline>

                  {(record.statsStatus === "pending" || record.statsStatus === "collecting") && (
                    <Text tone="muted" size="sm">
                      会議終了後に集計します。
                    </Text>
                  )}

                  {(record.statsStatus === "failed" || record.statsStatus === "expired") && (
                    <Text tone="muted" size="sm">
                      集計できませんでした。
                    </Text>
                  )}

                  {record.statsStatus === "collected" && (
                    <Stack>
                      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <dt className="font-semibold text-muted">参加者数</dt>
                          <dd>{record.participantCount ?? 0} 人</dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-muted">ピーク同時接続数</dt>
                          <dd>{record.peakConcurrent ?? 0} 人</dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-muted">平均滞在時間</dt>
                          <dd>{formatDurationJa(avgSeconds)}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-muted">招待者の出席</dt>
                          <dd>
                            {record.inviteeAttendedCount ?? 0} / {record.totalInviteeCount} 人
                          </dd>
                        </div>
                      </dl>

                      <Text tone="muted" size="sm">
                        内訳: 招待外 {record.nonInviteeCount ?? 0} 人 ・ 匿名{" "}
                        {record.anonymousCount ?? 0} 人 ・ 電話 {record.phoneCount ?? 0} 人
                      </Text>

                      {record.participants && record.participants.length > 0 && (
                        <ParticipantStatsTable
                          participants={record.participants}
                          timeZone={timeZone}
                        />
                      )}
                    </Stack>
                  )}
                </Stack>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
