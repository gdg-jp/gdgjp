import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConferenceStatsView } from "../stats";
import { ConferenceStatsCard } from "./ConferenceStatsCard";

const BASE_RECORD: ConferenceStatsView = {
  name: "conferenceRecords/cr-1",
  startTime: "2026-11-19T10:00:00.000Z",
  endTime: "2026-11-19T11:00:00.000Z",
  statsStatus: "collected",
  participantCount: 3,
  inviteeAttendedCount: 1,
  totalInviteeCount: 2,
  peakConcurrent: 2,
  totalAttendanceSeconds: 3600,
  nonInviteeCount: 1,
  anonymousCount: 1,
  phoneCount: 0,
  transcriptStatsStatus: "collected",
  participants: null,
};

describe("ConferenceStatsCard", () => {
  it("開催記録が 0 件のとき案内メッセージを表示する", () => {
    const html = renderToStaticMarkup(<ConferenceStatsCard stats={[]} timeZone="Asia/Tokyo" />);
    expect(html).toContain("参加状況・会議統計");
    expect(html).toContain("会議の開催記録はまだありません");
  });

  it("pending / failed 状態ではそれぞれの案内文を表示する", () => {
    const html = renderToStaticMarkup(
      <ConferenceStatsCard
        stats={[
          { ...BASE_RECORD, name: "conferenceRecords/p", statsStatus: "pending" },
          { ...BASE_RECORD, name: "conferenceRecords/f", statsStatus: "failed" },
        ]}
        timeZone="Asia/Tokyo"
      />,
    );
    expect(html).toContain("会議終了後に集計します");
    expect(html).toContain("集計できませんでした");
  });

  it("一般参加者向け（participants: null）では集計値のみを表示し個人別テーブルを出さない", () => {
    const html = renderToStaticMarkup(
      <ConferenceStatsCard stats={[BASE_RECORD]} timeZone="Asia/Tokyo" />,
    );
    expect(html).toContain("3 人");
    expect(html).toContain("2 人");
    expect(html).toContain("20分");
    expect(html).toContain("1 / 2 人");
    expect(html).toContain("招待外 1 人 ・ 匿名 1 人 ・ 電話 0 人");
    expect(html).not.toContain("<table");
  });

  it("共同主催者向け（participants あり）では個人別テーブルと発言時間（参考値）を表示する", () => {
    const html = renderToStaticMarkup(
      <ConferenceStatsCard
        stats={[
          {
            ...BASE_RECORD,
            participants: [
              {
                key: "k-1",
                displayName: "共同主催者A",
                maskedEmail: "a***@example.com",
                category: "cohost",
                attended: true,
                earliestStartTime: "2026-11-19T10:00:00.000Z",
                latestEndTime: "2026-11-19T10:40:00.000Z",
                totalSeconds: 2400,
                sessionCount: 2,
                speakingSeconds: 95,
              },
              {
                key: "k-2",
                displayName: "欠席者B",
                maskedEmail: "b***@example.com",
                category: "invitee",
                attended: false,
                earliestStartTime: null,
                latestEndTime: null,
                totalSeconds: 0,
                sessionCount: 0,
                speakingSeconds: null,
              },
            ],
          },
        ]}
        timeZone="Asia/Tokyo"
      />,
    );
    expect(html).toContain("<table");
    expect(html).toContain("発言時間（参考値）");
    expect(html).toContain("1分35秒（参考値）");
    expect(html).toContain("共同主催者A");
    expect(html).toContain("a***@example.com");
    expect(html).toContain("欠席者B");
    expect(html).toContain("未出席");
    expect(html).toContain("2 回");
  });
});
