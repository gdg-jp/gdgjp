import { describe, expect, it, vi } from "vitest";
import { enqueueArtifactReshareForMeeting } from "./artifact-reshare.server";

function createFakeArtifactDb(artifactIds: string[]) {
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          args = values;
          return stmt;
        },
        async all<T>() {
          if (sql.includes("FROM artifacts WHERE meeting_id = ?")) {
            const meetingId = String(args[0]);
            return {
              results: artifactIds.map((id) => ({
                id,
                meeting_id: meetingId,
                conference_record: "conferenceRecords/conf-1",
                kind: "recording",
                drive_file_id: `drive-${id}`,
                title: `ファイル ${id}`,
                mime_type: "video/mp4",
                web_view_link: `https://drive.google.com/file/d/drive-${id}/view`,
                created_at: "2026-11-19T12:00:00.000Z",
                shared_at: "2026-11-19T12:01:00.000Z",
                attached_at: "2026-11-19T12:01:00.000Z",
                last_error: null,
                attempts: 0,
              })) as T[],
            };
          }
          throw new Error(`未対応の all(): ${sql}`);
        },
      };
      return stmt;
    },
  };
  return db as unknown as D1Database;
}

describe("enqueueArtifactReshareForMeeting", () => {
  it("該当会議の全 artifacts に対して share_artifact ジョブを投入する", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const env = {
      DB: createFakeArtifactDb(["art-1", "art-2", "art-3"]),
      MEET_JOBS: { send },
    } as unknown as Env;

    await enqueueArtifactReshareForMeeting(env, "mtg-1");

    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenNthCalledWith(1, { type: "share_artifact", artifactId: "art-1" });
    expect(send).toHaveBeenNthCalledWith(2, { type: "share_artifact", artifactId: "art-2" });
    expect(send).toHaveBeenNthCalledWith(3, { type: "share_artifact", artifactId: "art-3" });
  });

  it("artifacts が 0 件の会議では MEET_JOBS.send を呼ばない", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const env = {
      DB: createFakeArtifactDb([]),
      MEET_JOBS: { send },
    } as unknown as Env;

    await enqueueArtifactReshareForMeeting(env, "mtg-empty");

    expect(send).not.toHaveBeenCalled();
  });
});
