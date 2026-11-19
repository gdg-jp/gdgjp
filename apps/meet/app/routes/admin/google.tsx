import {
  Alert,
  Badge,
  Button,
  Card,
  Heading,
  Inline,
  PageHeader,
  Separator,
  Stack,
  Text,
  TypographyInlineCode,
} from "@gdgjp/design-system";
import { Form, redirect, useNavigation } from "react-router";
import { formatArtifactDateTimeJst } from "~/features/artifacts/artifact";
import { FailedArtifactsCard } from "~/features/artifacts/components/FailedArtifactsCard";
import {
  getArtifactById,
  listFailedArtifacts,
  resetArtifactForRetry,
} from "~/features/artifacts/repository.server";
import { requireAdmin } from "~/features/auth/access.server";
import { SubscriptionStatusCard } from "~/features/events/components/SubscriptionStatusCard";
import { ensureSubscription, getGoogleSubscription } from "~/features/events/subscription.server";
import {
  buildGoogleAuthorizeUrl,
  createGoogleOauthState,
  getGoogleConnectionSummary,
} from "~/features/google/oauth.server";
import { toSafeErrorSummary } from "~/features/meetings/invite-resolution.server";
import { AppLayout } from "~/layouts/AppLayout";
import type { Route } from "./+types/google";

export function meta() {
  return [{ title: "Google 接続設定 — GDG Japan Meet" }];
}

function isOAuthConfigured(env: Env): boolean {
  return Boolean(
    env.GOOGLE_CLIENT_ID.trim() &&
      env.GOOGLE_CLIENT_SECRET.trim() &&
      env.GOOGLE_TOKEN_ENCRYPTION_KEY.trim(),
  );
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireAdmin(env, request);
  const url = new URL(request.url);
  const [connection, subscription, failedArtifacts] = await Promise.all([
    getGoogleConnectionSummary(env.DB),
    getGoogleSubscription(env.DB),
    listFailedArtifacts(env.DB),
  ]);

  return {
    user: {
      name: user.name,
      email: user.email,
      image: user.image,
      isAdmin: user.isAdmin,
    },
    accountsUrl: env.ACCOUNTS_URL,
    hostEmail: env.GOOGLE_HOST_EMAIL,
    isConfigured: isOAuthConfigured(env),
    connection,
    subscription,
    failedArtifacts,
    pubsubTopic: env.GOOGLE_PUBSUB_TOPIC.trim(),
    pubsubConfigured: Boolean(env.PUBSUB_PUSH_SERVICE_ACCOUNT.trim()),
    flashStatus: url.searchParams.get("status"),
    flashError: url.searchParams.get("error"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireAdmin(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "connect");

  if (intent === "refresh_subscription") {
    try {
      const result = await ensureSubscription(env, { forceRenew: true });
      if (!result.ok) {
        return {
          intent: "refresh_subscription" as const,
          ok: false as const,
          error:
            result.reason === "not_connected"
              ? "共有 Google アカウントが接続されていないため購読を更新できません。"
              : "GOOGLE_PUBSUB_TOPIC が未設定のため購読を更新できません。",
        };
      }
      return {
        intent: "refresh_subscription" as const,
        ok: true as const,
        action: result.action,
      };
    } catch (error) {
      return {
        intent: "refresh_subscription" as const,
        ok: false as const,
        error: toSafeErrorSummary(error),
      };
    }
  }

  if (intent === "retry_artifact") {
    const artifactId = String(formData.get("artifactId") ?? "").trim();
    if (!artifactId) {
      return {
        intent: "retry_artifact" as const,
        ok: false as const,
        error: "再試行する生成ファイル ID が指定されていません。",
      };
    }
    const artifact = await getArtifactById(env.DB, artifactId);
    if (!artifact) {
      return {
        intent: "retry_artifact" as const,
        ok: false as const,
        error: "対象の生成ファイルが見つかりません。",
      };
    }
    try {
      await resetArtifactForRetry(env.DB, artifactId);
      await env.MEET_JOBS.send({ type: "share_artifact", artifactId });
      return {
        intent: "retry_artifact" as const,
        ok: true as const,
        artifactTitle: artifact.title,
      };
    } catch (error) {
      return {
        intent: "retry_artifact" as const,
        ok: false as const,
        error: toSafeErrorSummary(error),
      };
    }
  }

  if (!isOAuthConfigured(env)) {
    return redirect("/admin/google?error=missing_config");
  }

  const { state, codeChallenge } = await createGoogleOauthState(env.DB, user.id);
  return redirect(buildGoogleAuthorizeUrl(env, state, codeChallenge));
}

const ERROR_MESSAGES: Record<string, string> = {
  missing_config:
    "Google OAuth 用の環境変数（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_TOKEN_ENCRYPTION_KEY）が未設定のため接続を開始できません。",
  missing_state: "認可状態のパラメータが見つかりませんでした。もう一度接続を実行してください。",
  state_invalid:
    "認可セッションの検証に失敗しました（期限切れ・再送信・別セッション）。もう一度接続を実行してください。",
  access_denied: "Google の同意画面でアクセスが拒否されました。",
  google_error: "Google の認可処理でエラーが発生しました。もう一度お試しください。",
  missing_code: "Google から認可コードを受け取れませんでした。もう一度お試しください。",
  exchange_failed:
    "Google トークンエンドポイントとのコード交換に失敗しました。クライアント設定とリダイレクト URI を確認してください。",
  scope_missing:
    "必要な権限（Meet・Calendar・Drive）のいずれかが許可されませんでした。すべての権限を許可して再接続してください。",
  missing_refresh_token:
    "リフレッシュトークンを取得できませんでした。同意画面ですべての権限を許可して再試行してください。",
  email_unverified: "選択された Google アカウントのメールアドレスが確認済みではありません。",
  wrong_account:
    "対象外の Google アカウントが選択されました。共有ホストアカウントでログインして再接続してください。",
  invalid_identity: "Google アカウント情報の検証に失敗しました。もう一度お試しください。",
  userinfo_failed: "Google ユーザー情報の取得に失敗しました。時間をおいてもう一度お試しください。",
};

const SUBSCRIPTION_ACTION_LABELS: Record<string, string> = {
  kept: "既存の有効な購読を確認しました。",
  extended: "購読の有効期限を延長しました。",
  reactivated: "一時停止されていた購読を再有効化しました。",
  created: "Workspace Events 購読を新規作成しました。",
  adopted_and_extended: "既存の Workspace Events 購読を採用して有効期限を延長しました。",
  recreated: "不一致だった既存購読を削除し、新しい購読を作成しました。",
};

export default function AdminGoogle({ loaderData, actionData }: Route.ComponentProps) {
  const {
    user,
    accountsUrl,
    hostEmail,
    isConfigured,
    connection,
    subscription,
    failedArtifacts,
    pubsubTopic,
    pubsubConfigured,
    flashStatus,
    flashError,
  } = loaderData;
  const navigation = useNavigation();
  const submittingIntent =
    navigation.state === "submitting"
      ? String(navigation.formData?.get("intent") ?? "connect")
      : "";
  const isConnecting = submittingIntent === "connect";
  const isRefreshingSubscription = submittingIntent === "refresh_subscription";
  const retryingArtifactId =
    submittingIntent === "retry_artifact"
      ? String(navigation.formData?.get("artifactId") ?? "")
      : null;

  const statusBadge =
    connection.status === "connected"
      ? { tone: "success" as const, label: "接続済み" }
      : connection.status === "disconnected"
        ? { tone: "danger" as const, label: "切断（再接続が必要）" }
        : { tone: "warning" as const, label: "未接続" };

  return (
    <AppLayout user={user} accountsUrl={accountsUrl}>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader
          title="Google 接続設定"
          description={`共有ホストアカウント（${hostEmail}）の Google OAuth 接続・Workspace Events 購読・生成ファイルジョブを管理します。`}
        />

        {flashStatus === "connected" && (
          <Alert tone="success" title="Google アカウントを接続しました">
            共有ホストアカウントの認可情報を暗号化して保存しました。
          </Alert>
        )}

        {flashError && (
          <Alert tone="danger" title="Google 接続に失敗しました">
            {ERROR_MESSAGES[flashError] ??
              "接続処理中にエラーが発生しました。もう一度お試しください。"}
          </Alert>
        )}

        {actionData?.intent === "refresh_subscription" && actionData.ok && (
          <Alert tone="success" title="Workspace Events 購読を更新しました">
            {SUBSCRIPTION_ACTION_LABELS[actionData.action] ?? "購読状態を更新しました。"}
          </Alert>
        )}

        {actionData?.intent === "refresh_subscription" && !actionData.ok && (
          <Alert tone="danger" title="Workspace Events 購読の更新に失敗しました">
            {actionData.error}
          </Alert>
        )}

        {actionData?.intent === "retry_artifact" && actionData.ok && (
          <Alert tone="success" title="生成ファイルの再共有ジョブを投入しました">
            「{actionData.artifactTitle}」の共有・添付処理を再試行キューへ追加しました。
          </Alert>
        )}

        {actionData?.intent === "retry_artifact" && !actionData.ok && (
          <Alert tone="danger" title="再試行の投入に失敗しました">
            {actionData.error}
          </Alert>
        )}

        {!isConfigured && (
          <Alert tone="warning" title="Google OAuth 環境変数が未設定です">
            GOOGLE_CLIENT_ID・GOOGLE_CLIENT_SECRET・GOOGLE_TOKEN_ENCRYPTION_KEY
            を設定すると接続を開始できます。
          </Alert>
        )}

        <Card>
          <Stack>
            <Inline className="items-center justify-between">
              <Heading level={2}>共有ホストアカウント接続</Heading>
              <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
            </Inline>

            {connection.status === "disconnected" && (
              <Alert tone="danger" title="トークンが失効しています（invalid_grant）">
                {connection.lastError ?? "リフレッシュトークンが無効になりました。"}
                下のボタンから再接続してください。
              </Alert>
            )}

            <Separator />

            <dl className="grid gap-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
              <dt className="font-semibold text-muted">接続対象アカウント</dt>
              <dd className="min-w-0 break-all">{hostEmail}</dd>

              {connection.status !== "unconnected" && (
                <>
                  <dt className="font-semibold text-muted">接続メールアドレス</dt>
                  <dd className="min-w-0 break-all">{connection.email}</dd>

                  <dt className="font-semibold text-muted">Google ユーザー ID</dt>
                  <dd className="min-w-0 break-all">
                    <TypographyInlineCode>{connection.googleUserId}</TypographyInlineCode>
                  </dd>

                  <dt className="font-semibold text-muted">付与済みスコープ</dt>
                  <dd className="min-w-0">
                    <Inline>
                      {connection.scopes.map((scope) => (
                        <Badge key={scope} tone="neutral" className="break-all">
                          {scope}
                        </Badge>
                      ))}
                    </Inline>
                  </dd>

                  <dt className="font-semibold text-muted">接続日時</dt>
                  <dd>{formatArtifactDateTimeJst(connection.connectedAt)}</dd>

                  <dt className="font-semibold text-muted">最終更新日時</dt>
                  <dd>{formatArtifactDateTimeJst(connection.updatedAt)}</dd>

                  {connection.lastError && (
                    <>
                      <dt className="font-semibold text-muted">直近のエラー</dt>
                      <dd className="min-w-0 break-all">{connection.lastError}</dd>
                    </>
                  )}
                </>
              )}
            </dl>

            {connection.status === "unconnected" && (
              <Text tone="muted" size="sm">
                まだ Google アカウントが接続されていません。下のボタンから {hostEmail}
                で認可を行ってください。
              </Text>
            )}

            <Separator />

            <Form method="post">
              <input type="hidden" name="intent" value="connect" />
              <Button type="submit" disabled={!isConfigured} loading={isConnecting}>
                {connection.status === "unconnected"
                  ? "Google アカウントを接続"
                  : "Google アカウントを再接続"}
              </Button>
            </Form>
          </Stack>
        </Card>

        <SubscriptionStatusCard
          subscription={subscription}
          connectionStatus={connection.status}
          pubsubTopic={pubsubTopic}
          pubsubConfigured={pubsubConfigured}
          isRefreshing={isRefreshingSubscription}
        />

        <FailedArtifactsCard artifacts={failedArtifacts} retryingArtifactId={retryingArtifactId} />
      </Stack>
    </AppLayout>
  );
}
