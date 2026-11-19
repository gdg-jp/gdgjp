import type {
  MeetArtifactConfig,
  MeetAutoGenerationType,
  MeetSpaceConfig,
} from "~/features/google/meet.server";
import type { MeetingAccessType, MeetingAutoArtifacts } from "./meeting";

export type SpaceConfigurableSettings = MeetingAutoArtifacts & {
  accessType: MeetingAccessType;
};

export type SpaceConfigPatch = {
  config: Pick<MeetSpaceConfig, "accessType" | "artifactConfig">;
  updateMask: string;
};

/** boolean 値を Meet API の `AutoGenerationType` へ変換する。 */
export function toMeetAutoGeneration(enabled: boolean): MeetAutoGenerationType {
  return enabled ? "ON" : "OFF";
}

/** `spaces.create` 向けの `artifactConfig` オブジェクトを組み立てる。 */
export function buildMeetArtifactConfig(artifacts: MeetingAutoArtifacts): MeetArtifactConfig {
  return {
    transcriptionConfig: {
      autoTranscriptionGeneration: toMeetAutoGeneration(artifacts.autoTranscription),
    },
    smartNotesConfig: {
      autoSmartNotesGeneration: toMeetAutoGeneration(artifacts.autoSmartNotes),
    },
    recordingConfig: {
      autoRecordingGeneration: toMeetAutoGeneration(artifacts.autoRecording),
    },
  };
}

/** 変更のあったスペース設定項目だけを抽出し、`spaces.patch` 用の `config` と `updateMask` を返す。 */
export function buildSpaceConfigPatch(
  current: SpaceConfigurableSettings,
  next: SpaceConfigurableSettings,
): SpaceConfigPatch | null {
  const config: Pick<MeetSpaceConfig, "accessType" | "artifactConfig"> = {};
  const artifactConfig: MeetArtifactConfig = {};
  const maskPaths: string[] = [];

  if (next.accessType !== current.accessType) {
    config.accessType = next.accessType;
    maskPaths.push("config.accessType");
  }
  if (next.autoTranscription !== current.autoTranscription) {
    artifactConfig.transcriptionConfig = {
      autoTranscriptionGeneration: toMeetAutoGeneration(next.autoTranscription),
    };
    maskPaths.push("config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration");
  }
  if (next.autoSmartNotes !== current.autoSmartNotes) {
    artifactConfig.smartNotesConfig = {
      autoSmartNotesGeneration: toMeetAutoGeneration(next.autoSmartNotes),
    };
    maskPaths.push("config.artifactConfig.smartNotesConfig.autoSmartNotesGeneration");
  }
  if (next.autoRecording !== current.autoRecording) {
    artifactConfig.recordingConfig = {
      autoRecordingGeneration: toMeetAutoGeneration(next.autoRecording),
    };
    maskPaths.push("config.artifactConfig.recordingConfig.autoRecordingGeneration");
  }

  if (maskPaths.length === 0) {
    return null;
  }

  if (Object.keys(artifactConfig).length > 0) {
    config.artifactConfig = artifactConfig;
  }

  return { config, updateMask: maskPaths.join(",") };
}
