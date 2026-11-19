import { describe, expect, it } from "vitest";
import { DEFAULT_MEETING_AUTO_ARTIFACTS } from "./meeting";
import { buildMeetArtifactConfig, buildSpaceConfigPatch } from "./space-config.server";

describe("buildMeetArtifactConfig", () => {
  it("既定設定（文字起こし ON / Gemini Notes ON / 録画 OFF）から artifactConfig を組み立てる", () => {
    expect(buildMeetArtifactConfig(DEFAULT_MEETING_AUTO_ARTIFACTS)).toEqual({
      transcriptionConfig: { autoTranscriptionGeneration: "ON" },
      smartNotesConfig: { autoSmartNotesGeneration: "ON" },
      recordingConfig: { autoRecordingGeneration: "OFF" },
    });
  });

  it("全オン・全オフの変換ができる", () => {
    expect(
      buildMeetArtifactConfig({
        autoTranscription: true,
        autoSmartNotes: true,
        autoRecording: true,
      }),
    ).toEqual({
      transcriptionConfig: { autoTranscriptionGeneration: "ON" },
      smartNotesConfig: { autoSmartNotesGeneration: "ON" },
      recordingConfig: { autoRecordingGeneration: "ON" },
    });

    expect(
      buildMeetArtifactConfig({
        autoTranscription: false,
        autoSmartNotes: false,
        autoRecording: false,
      }),
    ).toEqual({
      transcriptionConfig: { autoTranscriptionGeneration: "OFF" },
      smartNotesConfig: { autoSmartNotesGeneration: "OFF" },
      recordingConfig: { autoRecordingGeneration: "OFF" },
    });
  });
});

describe("buildSpaceConfigPatch", () => {
  const base = {
    accessType: "RESTRICTED" as const,
    autoTranscription: true,
    autoSmartNotes: true,
    autoRecording: false,
  };

  it("変更が無い場合は null を返す", () => {
    expect(buildSpaceConfigPatch(base, { ...base })).toBeNull();
  });

  it("accessType のみ変更時は config.accessType のみをマスクに含める", () => {
    expect(buildSpaceConfigPatch(base, { ...base, accessType: "TRUSTED" })).toEqual({
      config: { accessType: "TRUSTED" },
      updateMask: "config.accessType",
    });
  });

  it("自動記録設定 1 項目のみ変更時は該当項目だけをパッチ対象にする", () => {
    expect(buildSpaceConfigPatch(base, { ...base, autoRecording: true })).toEqual({
      config: {
        artifactConfig: {
          recordingConfig: { autoRecordingGeneration: "ON" },
        },
      },
      updateMask: "config.artifactConfig.recordingConfig.autoRecordingGeneration",
    });
  });

  it("accessType と複数 artifact 設定を同時変更すると 1 つのパッチへまとめる", () => {
    expect(
      buildSpaceConfigPatch(base, {
        accessType: "OPEN",
        autoTranscription: false,
        autoSmartNotes: true,
        autoRecording: true,
      }),
    ).toEqual({
      config: {
        accessType: "OPEN",
        artifactConfig: {
          transcriptionConfig: { autoTranscriptionGeneration: "OFF" },
          recordingConfig: { autoRecordingGeneration: "ON" },
        },
      },
      updateMask: [
        "config.accessType",
        "config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration",
        "config.artifactConfig.recordingConfig.autoRecordingGeneration",
      ].join(","),
    });
  });
});
