import { describe, expect, it } from "vitest";
import { ARTIFACT_KIND_META } from "./artifact";

describe("ARTIFACT_KIND_META", () => {
  it("maps each artifact kind to its official Drive logo and row icon", () => {
    expect(ARTIFACT_KIND_META.notes.driveLogo).toBe("docs");
    expect(ARTIFACT_KIND_META.chat_log.driveLogo).toBe("docs");
    expect(ARTIFACT_KIND_META.recording.driveLogo).toBe("drive-video");

    expect(ARTIFACT_KIND_META.notes.icon).toBe("FileText");
    expect(ARTIFACT_KIND_META.chat_log.icon).toBe("MessageSquare");
    expect(ARTIFACT_KIND_META.recording.icon).toBe("Play");
  });
});
