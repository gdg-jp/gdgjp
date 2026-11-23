import {
  Badge,
  Button,
  Card,
  Heading,
  Icons,
  Inline,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Separator,
  Stack,
  Text,
} from "@gdgjp/design-system";
import { GoogleWorkspaceLogo } from "~/components/GoogleWorkspaceLogo";
import { ARTIFACT_KIND_META, type PublicArtifact, formatArtifactDateTimeJst } from "../artifact";

export type ArtifactListProps = {
  artifacts: readonly PublicArtifact[];
};

function describeArtifactStatus(artifact: PublicArtifact): string {
  const parts = [formatArtifactDateTimeJst(artifact.createdAt)];
  if (artifact.sharedAt && artifact.attachedAt) {
    parts.push("共有・予定添付済み");
  } else if (artifact.sharedAt) {
    parts.push("Drive 共有済み・予定添付待ち");
  } else {
    parts.push("共有処理待ち");
  }
  return parts.join(" ・ ");
}

export function ArtifactList({ artifacts }: ArtifactListProps) {
  return (
    <Card>
      <Stack>
        <Inline className="items-center justify-between">
          <Heading level={2}>生成ファイル</Heading>
          {artifacts.length > 0 && (
            <Text tone="muted" size="sm">
              {artifacts.length} 件
            </Text>
          )}
        </Inline>

        <Separator />

        {artifacts.length === 0 ? (
          <Text tone="muted" size="sm">
            録画・チャット記録・文字起こし・Gemini
            メモは会議終了から数分（長時間会議ではさらに長くなる場合があります）後に自動で共有・添付されます。
          </Text>
        ) : (
          <ItemGroup>
            {artifacts.map((artifact) => {
              const meta = ARTIFACT_KIND_META[artifact.kind];
              return (
                <Item key={artifact.id} variant="outline">
                  <ItemMedia>
                    <Icons name={meta.icon} size={18} aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      <Inline className="items-center">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        <span className="break-all">{artifact.title}</span>
                      </Inline>
                    </ItemTitle>
                    <ItemDescription>{describeArtifactStatus(artifact)}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button variant="outline" size="sm" asChild>
                      <a href={artifact.webViewLink} target="_blank" rel="noopener noreferrer">
                        <GoogleWorkspaceLogo brand={meta.driveLogo} size={16} />
                        Google ドライブで開く
                      </a>
                    </Button>
                  </ItemActions>
                </Item>
              );
            })}
          </ItemGroup>
        )}
      </Stack>
    </Card>
  );
}
