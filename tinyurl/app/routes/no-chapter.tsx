import { redirect } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { getAuth } from "~/lib/auth.server";
import { ClaimsUnavailableError, fetchChapterForUser } from "~/lib/chapter.server";
import type { Route } from "./+types/no-chapter";

export function meta() {
  return [{ title: "Join a GDG — GDG Japan Links" }];
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const user = await getAuth(env).getSessionUser(args.request);
  if (!user) throw redirect("/signin?return_to=%2Fno-chapter");
  let chapter: Awaited<ReturnType<typeof fetchChapterForUser>>;
  try {
    chapter = await fetchChapterForUser(env, user.id);
  } catch (err) {
    if (err instanceof ClaimsUnavailableError) throw redirect("/signin?return_to=%2Fno-chapter");
    throw err;
  }
  if (chapter) throw redirect("/dashboard");
  return { accountsUrl: env.ACCOUNTS_URL };
}

export default function NoChapter({ loaderData }: Route.ComponentProps) {
  const { accountsUrl } = loaderData;
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <GdgMark size="md" />
          <CardTitle className="mt-2 text-xl">Join a GDG to continue</CardTitle>
          <CardDescription>
            GDG Japan Links is available to members of a GDG or GDG on Campus chapter. Join a
            chapter to create and manage short links. You can still open existing short links
            (gdgs.jp/&hellip;) without a membership.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button asChild>
            <a href={`${accountsUrl}/onboarding`}>Join a chapter</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
