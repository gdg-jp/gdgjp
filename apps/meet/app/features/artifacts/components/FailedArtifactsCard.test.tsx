import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FailedArtifactItem } from "../artifact";
import { FailedArtifactsCard } from "./FailedArtifactsCard";

vi.mock("react-router", () => ({
  Form: ({ children, ...props }: { children: ReactNode; method?: string }) => (
    <form {...props}>{children}</form>
  ),
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

function makeItem(overrides: Partial<FailedArtifactItem>): FailedArtifactItem {
  return {
    id: "art-1",
    meetingId: "mtg-1",
    meetingTitle: "テスト会議",
    conferenceRecord: "conferenceRecords/1",
    kind: "recording",
    driveFileId: "df-1",
    title: "録画",
    mimeType: "video/mp4",
    webViewLink: "https://drive.google.com/1",
    createdAt: "2026-11-20T00:00:00.000Z",
    sharedAt: null,
    attachedAt: null,
    lastError: "500 INTERNAL",
    attempts: 1,
    ...overrides,
  };
}

describe("FailedArtifactsCard", () => {
  it("失敗・未完了と警告あり（完了済み）を別セクションに分け、件数に含めず両方に再試行ボタンを表示する", () => {
    const html = renderToStaticMarkup(
      <FailedArtifactsCard
        artifacts={[makeItem({ id: "art-fail", title: "未完了ファイル" })]}
        warningArtifacts={[
          makeItem({
            id: "art-warn",
            title: "完了済み警告ファイル",
            sharedAt: "2026-11-20T01:00:00.000Z",
            attachedAt: "2026-11-20T01:00:00.000Z",
            lastError: "一部招待者への Drive 共有をスキップしました (400)",
            attempts: 0,
          }),
        ]}
        retryingArtifactId={null}
      />,
    );
    expect(html).toContain("失敗・未完了の生成ファイルジョブ");
    expect(html).toContain("1 件");
    expect(html).toContain("未完了ファイル");
    expect(html).toContain("警告あり（完了済み）");
    expect(html).toContain("完了済み警告ファイル");
    expect(html.match(/name="intent" value="retry_artifact"/g)).toHaveLength(2);
  });

  it("失敗・未完了が 0 件で警告あり（完了済み）がある場合は失敗件数を 0 件と表示する", () => {
    const html = renderToStaticMarkup(
      <FailedArtifactsCard
        artifacts={[]}
        warningArtifacts={[
          makeItem({
            id: "art-warn",
            title: "完了済み警告ファイル",
            sharedAt: "2026-11-20T01:00:00.000Z",
            attachedAt: "2026-11-20T01:00:00.000Z",
            lastError: "一部招待者への Drive 共有をスキップしました (400)",
          }),
        ]}
        retryingArtifactId={null}
      />,
    );
    expect(html).toContain("0 件");
    expect(html).toContain("失敗または未完了の生成ファイルジョブはありません。");
    expect(html).toContain("警告あり（完了済み）");
    expect(html).toContain("1 件");
    expect(html).toContain("再試行");
  });
});
