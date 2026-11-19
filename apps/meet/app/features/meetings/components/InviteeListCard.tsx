import {
  Badge,
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
import type { PublicInvitee } from "../meeting";

export type InviteeListCardProps = {
  invitees: readonly PublicInvitee[];
};

function resolveInviteePrimaryLabel(invitee: PublicInvitee): string {
  if (invitee.displayName) return invitee.displayName;
  if (invitee.email) return invitee.email;
  return "外部招待者（メール非公開）";
}

function resolveInviteeSubLabel(invitee: PublicInvitee): string | null {
  if (invitee.displayName && invitee.email) {
    return invitee.email;
  }
  if (invitee.isChapterDerived) {
    return "チャプター所属メンバー";
  }
  if (invitee.email) {
    return "個別メール招待";
  }
  return null;
}

/** 会議詳細画面の招待者一覧カード（チャプター由来のメールアドレスは非表示）。 */
export function InviteeListCard({ invitees }: InviteeListCardProps) {
  const cohostCount = invitees.filter((inv) => inv.role === "cohost").length;
  const participantCount = invitees.length - cohostCount;

  return (
    <Card>
      <Stack>
        <Inline className="items-center justify-between">
          <Heading level={2}>招待者</Heading>
          <Text tone="muted" size="sm">
            合計 {invitees.length} 名（共同主催者 {cohostCount} 名 / 参加者 {participantCount} 名）
          </Text>
        </Inline>

        <Text tone="muted" size="sm">
          チャプター所属由来の招待者は名前と役割のみ表示され、メールアドレスは表示されません。
        </Text>

        <Separator />

        {invitees.length === 0 ? (
          <Text tone="muted" size="sm">
            招待者はいません。
          </Text>
        ) : (
          <ItemGroup>
            {invitees.map((invitee, index) => {
              const primaryLabel = resolveInviteePrimaryLabel(invitee);
              const subLabel = resolveInviteeSubLabel(invitee);
              return (
                <Item key={`${invitee.role}-${primaryLabel}-${index}`} variant="outline">
                  <ItemMedia>
                    <Icons name="UserRound" size={18} aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="break-all">{primaryLabel}</ItemTitle>
                    {subLabel && (
                      <ItemDescription className="break-all">{subLabel}</ItemDescription>
                    )}
                  </ItemContent>
                  <ItemActions>
                    <Inline>
                      {invitee.isCreator && <Badge tone="neutral">作成者</Badge>}
                      <Badge tone={invitee.role === "cohost" ? "info" : "neutral"}>
                        {invitee.role === "cohost" ? "共同主催者" : "参加者"}
                      </Badge>
                    </Inline>
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
