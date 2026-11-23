import { listArtifactsByMeetingId } from "~/features/artifacts/repository.server";
import { toSafeErrorSummary } from "~/features/google/error-summary.server";
import { updateMeetingLastError } from "./meetings.repository.server";

/**
 * 招待者変更・チャプター再同期時に既存の生成ファイル（`artifacts`）を再共有する。
 * 該当会議の `artifacts` 全件に対して `{ type: "share_artifact", artifactId }` を `MEET_JOBS` へ投入する。
 */
export async function enqueueArtifactReshareForMeeting(env: Env, meetingId: string): Promise<void> {
  const artifacts = await listArtifactsByMeetingId(env.DB, meetingId);
  for (const artifact of artifacts) {
    await env.MEET_JOBS.send({
      type: "share_artifact",
      artifactId: artifact.id,
    });
  }
}

/** 予定と D1 の更新は済んでいるため、再共有ジョブの投入に失敗しても保存自体は成功として扱う。 */
export async function enqueueArtifactReshareSafely(
  env: Env,
  meetingId: string,
  enqueueFn: (env: Env, meetingId: string) => Promise<void>,
  now: () => Date,
): Promise<void> {
  try {
    await enqueueFn(env, meetingId);
  } catch (error) {
    await updateMeetingLastError(
      env.DB,
      meetingId,
      `生成ファイルの再共有ジョブの投入に失敗しました: ${toSafeErrorSummary(error)}`.slice(0, 240),
      now().toISOString(),
    );
  }
}
