/**
 * 招待者変更・チャプター再同期時に既存の生成ファイル（`artifacts`）を再共有するための境界フック。
 * Stage 06 未実装の間は `artifacts` テーブルが存在しないため no-op とし、
 * Stage 06 の実装時に該当会議の `artifacts` 全件へ `share_artifact` ジョブを投入する処理へ接続する。
 */
export async function enqueueArtifactReshareForMeeting(
  _env: Env,
  _meetingId: string,
): Promise<void> {
  // Stage 06 で `artifacts` テーブルと `share_artifact` ジョブを接続する。
}
