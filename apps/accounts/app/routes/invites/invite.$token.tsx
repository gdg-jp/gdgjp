import { Card } from "@gdgjp/design-system";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { LocaleSwitcher } from "~/components/locale-switcher";
import { ThemeToggle } from "~/components/theme-toggle";
import { loadInviteAcceptance } from "~/features/invites/accept.server";
import { InviteJoined, InviteUnavailable } from "~/features/invites/components/invite-result";
import type { RouteData } from "~/lib/route-data";
import type { Route } from "./+types/invite.$token";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }, { name: "robots", content: "noindex" }];
}

export function loader(args: Route.LoaderArgs) {
  return loadInviteAcceptance(args);
}

type PageProps = { loaderData: RouteData<typeof loadInviteAcceptance> };

export default function InvitePage({ loaderData }: PageProps) {
  const { t } = useTranslation();
  return (
    <div className="min-h-dvh bg-background">
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>
      <main className="grid min-h-dvh place-items-center px-4 py-10">
        <Card className="w-full max-w-lg">
          <div className="mb-6 flex justify-center">
            <Link to="/" aria-label={t("nav.homeAria")}>
              <GdgMark size="md" />
            </Link>
          </div>
          {loaderData.state === "joined" ? (
            <InviteJoined chapters={loaderData.chapters} />
          ) : (
            <InviteUnavailable reason={loaderData.state} />
          )}
        </Card>
      </main>
    </div>
  );
}
