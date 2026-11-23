import { Badge, Inline } from "@gdgjp/design-system";
import { MEETING_AUTO_ARTIFACT_OPTIONS, type MeetingAutoArtifacts } from "../meeting";

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
