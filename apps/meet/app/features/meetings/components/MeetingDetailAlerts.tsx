import { Alert, Stack, Text, Link as UiLink } from "@gdgjp/design-system";
import { Link as RouterLink } from "react-router";
import type { GoogleConnectionSummary } from "~/features/google/connection.server";
import type { CancelMeetingResult } from "../cancel-meeting.server";
import type { MeetingStatus } from "../meeting";
import type { ResyncMeetingResult } from "../update-meeting.server";

export type MeetingDetailAlertsProps = {
  flashUpdated: boolean;
  showCohostAddedNotice: boolean;
  showInviteeRemovedNotice: boolean;
  resyncResult?: ResyncMeetingResult;
  cancelResult?: CancelMeetingResult;
  meetingStatus: MeetingStatus;
  lastError: string | null;
  canEdit: boolean;
  isAdmin: boolean;
  googleConnectionStatus: GoogleConnectionSummary["status"];
};

/** 会議詳細画面上部に表示する更新通知・再同期/取り消し結果・状態アラート群。 */
export function MeetingDetailAlerts({
  flashUpdated,
  showCohostAddedNotice,
  showInviteeRemovedNotice,
  resyncResult,
  cancelResult,
  meetingStatus,
  lastError,
  canEdit,
  isAdmin,
  googleConnectionStatus,
}: MeetingDetailAlertsProps) {
  return (
    <>
      {flashUpdated && (
        <Alert tone="success" title="会議を更新しました">
          Google カレンダーの予定を更新し、招待者へ更新通知メールを送信しました。
        </Alert>
      )}

      {resyncResult?.ok && (
        <Alert tone="success" title="チャプターから再同期しました">
          再同期しました（招待者 {resyncResult.totalCount} 名、
          {resyncResult.changed ? "変更あり" : "変更なし"}）
        </Alert>
      )}

      {resyncResult && !resyncResult.ok && (
        <Alert tone="danger" title="チャプターからの再同期に失敗しました">
          {resyncResult.error}
        </Alert>
      )}

      {(showCohostAddedNotice || showInviteeRemovedNotice) && (
        <Alert tone="info" title="招待者変更に関するご注意">
          <Stack>
            {showCohostAddedNotice && (
              <Text size="sm">
                会議中に共同主催者（co-host）に追加された人は、会議に入り直すとホスト管理が使えます。
              </Text>
            )}
            {showInviteeRemovedNotice && (
              <Text size="sm">
                招待者を後から外した場合でも、既に共有済みの Google
                ドライブファイルの閲覧権限は自動では剥奪されません。
              </Text>
            )}
          </Stack>
        </Alert>
      )}

      {cancelResult?.ok && (
        <Alert tone="success" title="会議を取り消しました">
          Google カレンダーの予定を削除し、Meet スペースのクリーンアップを開始しました。
        </Alert>
      )}

      {cancelResult && !cancelResult.ok && (
        <Alert tone="danger" title="会議の取り消しに失敗しました">
          {cancelResult.error}
        </Alert>
      )}

      {meetingStatus === "canceled" && (
        <Alert tone="info" title="この会議は取り消し済みです">
          Google カレンダーの予定は削除されており、編集・再同期・再取り消しはできません。Meet
          スペースの登録メンバーはバックグラウンドで削除され、アクセス設定は「制限付き」へ戻ります。
        </Alert>
      )}

      {meetingStatus === "failed" && (
        <Alert tone="danger" title="会議の作成に失敗しました">
          {lastError ??
            "Google API の呼び出し中にエラーが発生したため、会議の作成が完了しませんでした。"}
        </Alert>
      )}

      {meetingStatus === "creating" && (
        <Alert tone="info" title="会議を作成しています">
          処理完了までしばらくお待ちください。数秒後に再読み込みしてください。
        </Alert>
      )}

      {meetingStatus === "active" && lastError && (
        <Alert tone="warning" title="メンバー同期でエラーまたは警告が発生しました">
          {lastError}
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
          {isAdmin && (
            <>
              {" "}
              <UiLink asChild>
                <RouterLink to="/admin/google">Google 接続設定を開く</RouterLink>
              </UiLink>
            </>
          )}
        </Alert>
      )}
    </>
  );
}
