import {
  Avatar,
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
  return invitee.displayName || invitee.email;
}

function resolveInviteeSubLabel(invitee: PublicInvitee): string {
  if (invitee.displayName) {
    return invitee.email;
  }
  return invitee.isChapterDerived ? "チャプター所属メンバー" : "個別メール招待";
}

/** 会議詳細画面の招待者一覧カード（閲覧権限がある全員に招待者全員の名前とメールアドレスを表示する）。 */
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
          招待者全員に、この一覧（名前とメールアドレス）が表示されます。Google
          カレンダーの予定でもゲスト一覧が公開されます。
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
                <Item key={`${invitee.role}-${invitee.email}-${index}`} variant="outline">
                  <ItemMedia variant="avatar">
                    <Avatar
                      src={invitee.avatarUrl ?? undefined}
                      alt={primaryLabel}
                      fallback={<Icons name="UserRound" size={18} aria-hidden="true" />}
                      className="shadow-none"
                    />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="break-all">{primaryLabel}</ItemTitle>
                    <ItemDescription className="break-all">{subLabel}</ItemDescription>
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
