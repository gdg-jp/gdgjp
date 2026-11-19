import { Card, EmptyState, PageHeader, Stack } from "@gdgjp/design-system";
import { buildSignInRedirect, requireUser } from "~/features/auth/access.server";
import { ClaimsUnavailableError, fetchChaptersForUser } from "~/features/auth/chapter.server";
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
  return {
    user: { name: user.name, email: user.email, image: user.image },
    accountsUrl: env.ACCOUNTS_URL,
    hasChapter,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { user, accountsUrl } = loaderData;
  return (
    <AppLayout user={user} accountsUrl={accountsUrl}>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader title="GDG Japan Meet" />
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
