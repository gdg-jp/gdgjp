import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { Button } from "~/components/ui/button";
import { ConnectDomainDialog } from "~/features/domains/components/connect-domain-dialog";
import { DomainCard } from "~/features/domains/components/domain-card";
import { loader as loadPage, action as mutatePage } from "~/features/domains/page.server";

import { DashboardPage, DashboardPageHeader } from "~/layouts/dashboard-page";
import { DashboardShell } from "~/layouts/dashboard-shell";
import type { Route } from "./+types/domains";

export function meta() {
  return [{ title: "Domains — GDG Japan Links" }];
}

export function loader(args: Route.LoaderArgs) {
  return loadPage(args);
}

export function action(args: Route.ActionArgs) {
  return mutatePage(args);
}

export default function Domains({ loaderData, actionData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const syncer = useFetcher();
  const [dialogOpen, setDialogOpen] = useState(false);
  const pending = loaderData.domains.some(
    (domain) =>
      domain.kind === "custom" && domain.status !== "active" && domain.status !== "deleted",
  );
  const syncSubmit = syncer.submit;

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => {
      if (syncer.state === "idle") syncSubmit({ intent: "syncAll" }, { method: "post" });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [pending, syncSubmit, syncer.state]);
  useEffect(() => {
    if (syncer.state === "idle" && syncer.data) revalidator.revalidate();
  }, [syncer.state, syncer.data, revalidator]);

  const organizers = loaderData.chapters.filter((chapter) =>
    loaderData.manageableIds.includes(chapter.chapterId),
  );
  return (
    <DashboardShell user={loaderData.user}>
      <DashboardPage>
        <DashboardPageHeader
          title="Domains"
          actions={
            organizers.length > 0 ? (
              <Button
                type="button"
                onClick={() => setDialogOpen(true)}
                disabled={loaderData.remainingDomains === 0}
              >
                <Plus className="size-4" /> Connect a domain you own
              </Button>
            ) : null
          }
        />

        {actionData && "error" in actionData ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {actionData.error}
          </p>
        ) : null}

        <div className="space-y-3">
          {loaderData.domains.map((domain) => (
            <DomainCard
              key={domain.id}
              domain={domain}
              chapterSlug={
                loaderData.chapters.find((chapter) => chapter.chapterId === domain.ownerChapterId)
                  ?.chapterSlug
              }
            />
          ))}
        </div>

        {organizers.length > 0 ? (
          <ConnectDomainDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            organizers={organizers}
            disabled={loaderData.remainingDomains === 0}
          />
        ) : null}
      </DashboardPage>
    </DashboardShell>
  );
}
