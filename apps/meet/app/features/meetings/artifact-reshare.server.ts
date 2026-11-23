import { listArtifactsByMeetingId } from "~/features/artifacts/repository.server";
import { toSafeErrorSummary } from "~/features/google/error-summary.server";
import { updateMeetingLastError } from "./meetings.repository.server";

export async function enqueueArtifactReshareForMeeting(env: Env, meetingId: string): Promise<void> {
  const artifacts = await listArtifactsByMeetingId(env.DB, meetingId);
  for (const artifact of artifacts) {
    await env.MEET_JOBS.send({
      type: "share_artifact",
      artifactId: artifact.id,
    });
  }
}

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
