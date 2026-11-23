import {
  Alert,
  Badge,
  Button,
  Card,
  Heading,
  Icons,
  Inline,
  Separator,
  Stack,
  Text,
  TypographyInlineCode,
} from "@gdgjp/design-system";
import { Form } from "react-router";
import { formatArtifactDateTimeJst } from "~/features/artifacts/artifact";
import type { GoogleSubscriptionRecord } from "../subscription.server";

export type SubscriptionStatusCardProps = {
  subscription: GoogleSubscriptionRecord | null;
  connectionStatus: "connected" | "disconnected" | "unconnected";
  pubsubTopic: string;
  pubsubConfigured: boolean;
  isRefreshing: boolean;
};

function getSubscriptionBadge(subscription: GoogleSubscriptionRecord | null): {
  tone: "success" | "danger" | "warning" | "neutral";
  label: string;
} {
  if (!subscription) return { tone: "warning", label: "未登録" };
  if (subscription.state === "ACTIVE") return { tone: "success", label: "ACTIVE" };
  if (subscription.state === "SUSPENDED") return { tone: "danger", label: "SUSPENDED" };
  return { tone: "neutral", label: subscription.state };
}

export function SubscriptionStatusCard({
  subscription,
  connectionStatus,
  pubsubTopic,
  pubsubConfigured,
  isRefreshing,
}: SubscriptionStatusCardProps) {
  const badge = getSubscriptionBadge(subscription);

  return (
    <Card>
      <Stack>
        <Inline className="items-center justify-between">
          <Heading level={2}>Workspace Events 購読状態</Heading>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </Inline>

        {!pubsubConfigured && (
          <Alert tone="warning" title="PUBSUB_PUSH_SERVICE_ACCOUNT が未設定です">
            Push 用サービスアカウントが設定されるまで、/api/google/events
            への通知リクエストはすべて拒否されます。
          </Alert>
        )}

        {subscription?.state === "SUSPENDED" && (
          <Alert tone="danger" title="Workspace Events 購読が一時停止されています">
            {subscription.lastError ??
              "購読が SUSPENDED 状態です。下のボタンから確認・更新してください。"}
          </Alert>
        )}

        <Separator />

        <dl className="grid gap-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
          <dt className="font-semibold text-muted">通知先トピック</dt>
          <dd className="min-w-0 break-all">
            <TypographyInlineCode>{pubsubTopic || "未設定"}</TypographyInlineCode>
          </dd>

          {subscription && (
            <>
              <dt className="font-semibold text-muted">購読名</dt>
              <dd className="min-w-0 break-all">
                <TypographyInlineCode>{subscription.name}</TypographyInlineCode>
              </dd>

              <dt className="font-semibold text-muted">状態</dt>
              <dd className="min-w-0">{subscription.state}</dd>

              <dt className="font-semibold text-muted">有効期限</dt>
              <dd className="min-w-0">{formatArtifactDateTimeJst(subscription.expireTime)}</dd>

              <dt className="font-semibold text-muted">最終確認・更新日時</dt>
              <dd className="min-w-0">{formatArtifactDateTimeJst(subscription.updatedAt)}</dd>

              {subscription.lastError && (
                <>
                  <dt className="font-semibold text-muted">直近のエラー</dt>
                  <dd className="min-w-0 break-all">{subscription.lastError}</dd>
                </>
              )}
            </>
          )}
        </dl>

        {!subscription && (
          <Text tone="muted" size="sm">
            まだ Workspace Events 購読が登録されていません。毎時 cron
            または下のボタンから購読を作成・更新できます。
          </Text>
        )}

        <Separator />

        <Form method="post">
          <input type="hidden" name="intent" value="refresh_subscription" />
          <Button
            type="submit"
            variant="outline"
            disabled={connectionStatus !== "connected" || !pubsubTopic}
            loading={isRefreshing}
          >
            <Icons name="RefreshCw" size={16} aria-hidden="true" />
            購読を今すぐ確認・更新
          </Button>
        </Form>
      </Stack>
    </Card>
  );
}
