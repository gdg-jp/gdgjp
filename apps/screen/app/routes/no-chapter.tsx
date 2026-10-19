import { redirect } from "react-router";
import { getAuth } from "~/features/auth/auth.server";
import { ClaimsUnavailableError, fetchChapterForUser } from "~/features/auth/chapter.server";
import type { Route } from "./+types/no-chapter";

export function meta() {
  return [{ title: "screen" }];
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
    <main className="screen-error">
      <p>GDG チャプターへの参加が必要です</p>
      <a href={`${loaderData.accountsUrl}/onboarding`}>accounts.gdgs.jp</a>
    </main>
  );
}
