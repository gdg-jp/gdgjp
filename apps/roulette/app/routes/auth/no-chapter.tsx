import { Button, Card, Heading, Stack, Text } from "@gdgjp/design-system";
import { redirect } from "react-router";
import { getAuth } from "~/features/auth/auth.server";
import { ClaimsUnavailableError, fetchChapterForUser } from "~/features/auth/chapter.server";
import type { Route } from "./+types/no-chapter";

export function meta() {
  return [{ title: "チャプター未所属 — GDG Roulette" }];
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const user = await getAuth(env).getSessionUser(args.request);
  if (!user) throw redirect("/signin?return_to=%2Fno-chapter");
  try {
    const chapter = await fetchChapterForUser(env, args.request);
    if (chapter) throw redirect("/");
  } catch (err) {
    if (err instanceof ClaimsUnavailableError) throw redirect("/signin?return_to=%2Fno-chapter");
    throw err;
  }
  return { accountsUrl: env.ACCOUNTS_URL };
}

export default function NoChapter({ loaderData }: Route.ComponentProps) {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <Card className="w-full max-w-md text-center">
        <Stack align="center">
          <Heading level={1} className="text-2xl">
            GDG チャプターへの参加が必要です
          </Heading>
          <Text tone="muted">
            GDG Roulette の管理画面は GDG / GDG on Campus
            チャプターのメンバーが利用できます。チャプターに参加してからもう一度お試しください。
          </Text>
          <Button asChild>
            <a href={`${loaderData.accountsUrl}/onboarding`}>チャプターに参加する</a>
          </Button>
        </Stack>
      </Card>
    </main>
  );
}
