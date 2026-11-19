import { describe, expect, it } from "vitest";
import {
  ARTIFACT_KIND_META,
  getCalendarAttachmentTitle,
  groupInviteeShareFailures,
} from "./artifact";

describe("ARTIFACT_KIND_META", () => {
  it("maps each artifact kind to its official Drive logo and row icon", () => {
    expect(ARTIFACT_KIND_META.notes.driveLogo).toBe("docs");
    expect(ARTIFACT_KIND_META.chat_log.driveLogo).toBe("docs");
    expect(ARTIFACT_KIND_META.recording.driveLogo).toBe("drive-video");

    expect(ARTIFACT_KIND_META.notes.icon).toBe("FileText");
    expect(ARTIFACT_KIND_META.chat_log.icon).toBe("MessageSquare");
    expect(ARTIFACT_KIND_META.recording.icon).toBe("Play");
  });

  it("maps each artifact kind to its short Google Calendar attachment title", () => {
    expect(getCalendarAttachmentTitle("notes")).toBe("要約・文字起こし");
    expect(getCalendarAttachmentTitle("recording")).toBe("録画");
    expect(getCalendarAttachmentTitle("chat_log")).toBe("チャットの記録");
  });
});

describe("groupInviteeShareFailures", () => {
  it("groups artifact failures by normalized email and resolves displayName/original email, and drops removed invitees", () => {
    const result = groupInviteeShareFailures(
      [
        {
          artifactId: "art-1",
          artifactKind: "recording",
          artifactTitle: "会議録画",
          emailNormalized: "ab@gmail.com",
          httpStatus: 400,
          apiStatus: "invalidSharingRequest",
          failedAt: "2026-11-20T00:00:00.000Z",
        },
        {
          artifactId: "art-2",
          artifactKind: "notes",
          artifactTitle: "会議メモ",
          emailNormalized: "ab@gmail.com",
          httpStatus: 400,
          apiStatus: "invalidSharingRequest",
          failedAt: "2026-11-20T00:01:00.000Z",
        },
        {
          artifactId: "art-1",
          artifactKind: "recording",
          artifactTitle: "会議録画",
          emailNormalized: "removed@example.com",
          httpStatus: 400,
          apiStatus: null,
          failedAt: "2026-11-20T00:00:00.000Z",
        },
      ],
      [{ emailNormalized: "ab@gmail.com", email: "A.B@gmail.com", displayName: "Alice" }],
    );

    expect(result).toEqual([
      {
        emailNormalized: "ab@gmail.com",
        email: "A.B@gmail.com",
        displayName: "Alice",
        artifacts: [
          {
            artifactId: "art-1",
            kind: "recording",
            title: "会議録画",
            httpStatus: 400,
            apiStatus: "invalidSharingRequest",
          },
          {
            artifactId: "art-2",
            kind: "notes",
            title: "会議メモ",
            httpStatus: 400,
            apiStatus: "invalidSharingRequest",
          },
        ],
      },
    ]);
  });
});
