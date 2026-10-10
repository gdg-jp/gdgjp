import { useTranslation } from "react-i18next";
import { PageHeader } from "~/components/page-header";
import { InviteCreateForm, InviteList } from "~/features/invites/components/invite-manager";
import { actOnInvites, loadInvites } from "~/features/invites/invites.server";
import { PageShell } from "~/layouts/page-shell";
import type { RouteData } from "~/lib/route-data";
import type { Route } from "./+types/chapters.invites";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export function loader(args: Route.LoaderArgs) {
  return loadInvites(args);
}

export function action(args: Route.ActionArgs) {
  return actOnInvites(args);
}

type PageProps = { loaderData: RouteData<typeof loadInvites> };

export default function ChapterInvitesPage({ loaderData }: PageProps) {
  const { t } = useTranslation();
  return (
    <PageShell size="md">
      <PageHeader title={t("invites.title")} description={t("invites.description")} />
      <section aria-labelledby="invite-create-heading" className="mt-8">
        <InviteCreateForm
          chapters={loaderData.chapters}
          preselectedChapterId={loaderData.preselectedChapterId}
        />
      </section>
      <section aria-labelledby="invite-list-heading" className="mt-8">
        <InviteList invites={loaderData.invites} />
      </section>
    </PageShell>
  );
}
