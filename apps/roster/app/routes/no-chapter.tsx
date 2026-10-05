import { redirect } from "react-router";
import { PublicShell } from "~/components/PublicShell";
import { getAuth } from "~/features/auth/auth.server";
import { ClaimsUnavailableError, fetchChapterForUser } from "~/features/auth/chapter.server";
import type { Route } from "./+types/no-chapter";

export function meta() {
  return [{ title: "チャプター未所属 — roster" }];
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
    <PublicShell>
      <div className="space-y-5 rounded-xl border border-border bg-surface p-6 text-center sm:p-8">
        <h1 className="text-2xl font-bold sm:text-3xl">GDG チャプターへの参加が必要です</h1>
        <p className="text-base text-neutral-600">
          roster の管理画面は GDG / GDG on Campus チャプターのメンバーが利用できます。
          チャプターに参加してからもう一度お試しください。
        </p>
        <a
          href={`${loaderData.accountsUrl}/onboarding`}
          className="inline-block rounded-full border-2 border-border bg-gdg-blue px-8 py-3 text-lg font-bold text-primary-foreground transition hover:brightness-95"
        >
          チャプターに参加する
        </a>
      </div>
    </PublicShell>
  );
}
