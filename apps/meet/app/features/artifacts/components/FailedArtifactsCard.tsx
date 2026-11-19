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
  Link as UiLink,
} from "@gdgjp/design-system";
import { Form, Link as RouterLink } from "react-router";
import {
  ARTIFACT_KIND_META,
  type FailedArtifactItem,
  formatArtifactDateTimeJst,
} from "../artifact";

export type FailedArtifactsCardProps = {
  artifacts: readonly FailedArtifactItem[];
  retryingArtifactId: string | null;
};

/** 管理画面（`/admin/google`）に表示する失敗・未完了の生成ファイルジョブ一覧と再試行カード。 */
export function FailedArtifactsCard({ artifacts, retryingArtifactId }: FailedArtifactsCardProps) {
  return (
    <Card>
      <Stack>
        <Inline className="items-center justify-between">
          <Heading level={2}>失敗・未完了の生成ファイルジョブ</Heading>
          <Badge tone={artifacts.length > 0 ? "warning" : "neutral"}>{artifacts.length} 件</Badge>
        </Inline>

        <Separator />

        {artifacts.length === 0 ? (
          <Text tone="muted" size="sm">
            失敗または未完了の生成ファイルジョブはありません。
          </Text>
        ) : (
          <ItemGroup>
            {artifacts.map((artifact) => {
              const meta = ARTIFACT_KIND_META[artifact.kind];
              const isRetrying = retryingArtifactId === artifact.id;
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
                    <ItemDescription>
                      <Stack>
                        <Inline className="items-center">
                          <UiLink asChild>
                            <RouterLink to={`/meetings/${artifact.meetingId}`}>
                              {artifact.meetingTitle}
                            </RouterLink>
                          </UiLink>
                          <Text tone="muted" size="sm">
                            試行回数: {artifact.attempts} ・ 作成:{" "}
                            {formatArtifactDateTimeJst(artifact.createdAt)} ・ 共有:{" "}
                            {artifact.sharedAt ? "完了" : "未完了"} ・ 添付:{" "}
                            {artifact.attachedAt ? "完了" : "未完了"}
                          </Text>
                        </Inline>
                        {artifact.lastError && (
                          <Text size="sm" className="break-all">
                            エラー: {artifact.lastError}
                          </Text>
                        )}
                      </Stack>
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Form method="post">
                      <input type="hidden" name="intent" value="retry_artifact" />
                      <input type="hidden" name="artifactId" value={artifact.id} />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        disabled={retryingArtifactId !== null}
                        loading={isRetrying}
                      >
                        <Icons name="RefreshCw" size={16} aria-hidden="true" />
                        再試行
                      </Button>
                    </Form>
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
