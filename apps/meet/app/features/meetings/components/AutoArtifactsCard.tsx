import { Card, Checkbox, Heading, Label, Stack, Text } from "@gdgjp/design-system";
import { useId } from "react";
import { MEETING_AUTO_ARTIFACT_OPTIONS, type MeetingAutoArtifacts } from "../meeting";

export type AutoArtifactsCardProps = {
  value: MeetingAutoArtifacts;
  onChange: (next: MeetingAutoArtifacts) => void;
};

export function AutoArtifactsCard({ value, onChange }: AutoArtifactsCardProps) {
  const idPrefix = useId();

  return (
    <Card>
      <Stack>
        <Heading level={2}>会議の自動記録設定</Heading>
        <Text tone="muted" size="sm">
          有効にした機能は、権限のある参加者が入室すると自動で開始され、会議終了後に生成ファイルが招待者全員へ自動共有されます。
        </Text>

        {MEETING_AUTO_ARTIFACT_OPTIONS.map((opt) => {
          const itemId = `${idPrefix}-${opt.key}`;
          return (
            <div key={opt.key} className="flex items-start gap-3">
              <Checkbox
                id={itemId}
                checked={value[opt.key]}
                onCheckedChange={(checked) => onChange({ ...value, [opt.key]: checked === true })}
              />
              <div className="min-w-0">
                <Label htmlFor={itemId}>{opt.label}</Label>
                <Text tone="muted" size="sm">
                  {opt.description}
                </Text>
              </div>
            </div>
          );
        })}
      </Stack>
    </Card>
  );
}
