import { Alert, Card, EmptyState, PageHeader, Stack, Link as UiLink } from "@gdgjp/design-system";
import { Link as RouterLink } from "react-router";
import { buildSignInRedirect, requireUser } from "~/features/auth/access.server";
import { ClaimsUnavailableError, fetchChaptersForUser } from "~/features/auth/chapter.server";
import { getGoogleConnectionSummary } from "~/features/google/oauth.server";
import { AppLayout } from "~/layouts/AppLayout";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "会議一覧 — GDG Japan Meet" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(env, request);
  let hasChapter = false;
  try {
    const resolved = await fetchChaptersForUser(env, request);
    hasChapter = resolved.primary !== null;
  } catch (err) {
    if (err instanceof ClaimsUnavailableError) throw buildSignInRedirect(request);
    throw err;
  }
  const googleConnection = await getGoogleConnectionSummary(env.DB);
  return {
    user: {
      name: user.name,
      email: user.email,
      image: user.image,
      isAdmin: user.isAdmin,
    },
    accountsUrl: env.ACCOUNTS_URL,
    hasChapter,
    googleConnectionStatus: googleConnection.status,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { user, accountsUrl, googleConnectionStatus } = loaderData;
  return (
    <AppLayout user={user} accountsUrl={accountsUrl}>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader title="GDG Japan Meet" />
        {googleConnectionStatus !== "connected" && (
          <Alert
            tone={googleConnectionStatus === "disconnected" ? "danger" : "warning"}
            title={
              googleConnectionStatus === "disconnected"
                ? "共有 Google アカウントの接続が切断されています"
                : "共有 Google アカウントが未接続です"
            }
          >
            {googleConnectionStatus === "disconnected"
              ? "トークンの失効により、会議の作成・更新ができない状態です。管理者が再接続するまでお待ちください。"
              : "管理者が共有 Google ホストアカウントを接続するまで、会議を作成できません。"}
            {user.isAdmin && (
              <>
                {" "}
                <UiLink asChild>
                  <RouterLink to="/admin/google">Google 接続設定を開く</RouterLink>
                </UiLink>
              </>
            )}
          </Alert>
        )}
        <Card>
          <EmptyState
            title="まだ会議がありません"
            description="作成または招待された Google Meet 会議がここに表示されます。"
          />
        </Card>
      </Stack>
    </AppLayout>
  );
}
