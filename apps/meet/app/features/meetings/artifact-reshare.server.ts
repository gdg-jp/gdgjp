import { listArtifactsByMeetingId } from "~/features/artifacts/repository.server";

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
