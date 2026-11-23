import { Alert, Badge, Inline, Stack, Text } from "@gdgjp/design-system";
import { ARTIFACT_KIND_META, type InviteeShareFailure } from "../artifact";

export type InviteeShareFailuresAlertProps = {
  failures: readonly InviteeShareFailure[];
};

export function InviteeShareFailuresAlert({ failures }: InviteeShareFailuresAlertProps) {
  if (failures.length === 0) return null;

  return (
    <Alert tone="warning" title="生成ファイルを共有できなかった招待者がいます">
      <Stack>
        <Text size="sm">
          次の招待者には生成ファイルを Drive
          で共有できませんでした。アドレスを確認し、正しいアドレスに直すか招待者から外してください。招待者を保存すると共有をやり直します。
        </Text>
        <ul className="space-y-2 text-sm">
          {failures.map((failure) => (
            <li key={failure.emailNormalized} className="space-y-1">
              <div className="font-medium break-all">
                {failure.displayName ? `${failure.displayName}（${failure.email}）` : failure.email}
              </div>
              <Inline className="items-center">
                {failure.artifacts.map((artifact) => {
                  const meta = ARTIFACT_KIND_META[artifact.kind];
                  return (
                    <Inline key={artifact.artifactId} className="items-center">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <Text size="sm" tone="muted" className="break-all">
                        {artifact.title}
                      </Text>
                    </Inline>
                  );
                })}
              </Inline>
            </li>
          ))}
        </ul>
      </Stack>
    </Alert>
  );
}
