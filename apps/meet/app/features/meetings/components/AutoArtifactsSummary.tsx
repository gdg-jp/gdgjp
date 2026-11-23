import { Badge, Inline } from "@gdgjp/design-system";
import { MEETING_AUTO_ARTIFACT_OPTIONS, type MeetingAutoArtifacts } from "../meeting";

/** 会議詳細画面で自動記録設定（文字起こし・Gemini Notes・録画）の有効/無効をバッジ表示する。 */
export function AutoArtifactsSummary(artifacts: MeetingAutoArtifacts) {
  return (
    <Inline>
      {MEETING_AUTO_ARTIFACT_OPTIONS.map((opt) => {
        const enabled = artifacts[opt.key];
        return (
          <Badge key={opt.key} tone={enabled ? "success" : "neutral"}>
            {opt.shortLabel}: {enabled ? "オン" : "オフ"}
          </Badge>
        );
      })}
    </Inline>
  );
}
