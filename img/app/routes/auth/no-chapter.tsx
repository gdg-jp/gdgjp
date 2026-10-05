import { Button, Card, Heading, Text } from "@gdgjp/design-system";
import { redirect } from "react-router";
import { getAuth } from "~/features/auth/auth.server";
import { ClaimsUnavailableError, fetchChapterForUser } from "~/features/auth/chapter.server";
import type { Route } from "./+types/no-chapter";

export function meta() {
  return [{ title: "Join a GDG — GDG Japan Image" }];
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const user = await getAuth(env).getSessionUser(args.request);
  if (!user) throw redirect("/signin?return_to=%2Fno-chapter");
  let chapter: Awaited<ReturnType<typeof fetchChapterForUser>>;
  try {
    chapter = await fetchChapterForUser(env, args.request);
  } catch (err) {
    if (err instanceof ClaimsUnavailableError) throw redirect("/signin?return_to=%2Fno-chapter");
    throw err;
  }
  if (chapter) throw redirect("/");
  return { accountsUrl: env.ACCOUNTS_URL };
}

export default function NoChapterPage({ loaderData }: Route.ComponentProps) {
  const { accountsUrl } = loaderData;
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <Card className="w-full max-w-md flex flex-col gap-4">
        <div className="items-center text-center">
          <Heading level={1} className="text-xl">
            Join a GDG to continue
          </Heading>
          <Text tone="muted" size="sm">
            GDG Japan Image is available to members of a GDG or GDG on Campus chapter. Anyone with
            the link can still view existing images.
          </Text>
        </div>
        <div className="flex justify-center">
          <Button asChild>
            <a href={`${accountsUrl}/onboarding`}>Join a chapter</a>
          </Button>
        </div>
      </Card>
    </div>
  );
}
