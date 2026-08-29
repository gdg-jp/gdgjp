import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLoaderData, useRevalidator, useSearchParams } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { getAccessIdentity, requireUser } from "~/features/auth/utils.server";
import SourceList from "~/features/sources/components/SourceList";
import SourcesToolbar from "~/features/sources/components/SourcesToolbar";
import { filterSources, parseSourceFilters } from "~/features/sources/components/filter-sources";
import { handleSourcesAction, loadSourcesPageData } from "~/features/sources/sources-page.server";
import { AddSourceSection } from "./_components/AddSourceSection";
import { ChatSenderDialog } from "./_components/ChatSenderDialog";

export const meta: MetaFunction = () => [{ title: "Sources — GDG Japan Wiki" }];

export async function loader({ request, context }: LoaderFunctionArgs) {
  return loadSourcesPageData(request, context.cloudflare.env);
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const form = await request.formData();
  return handleSourcesAction(env, form, user, identity);
}

export default function SourcesPage() {
  const { allChapters, assignableChapters, chatSenders, currentUserId, isAdmin, sources } =
    useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation();
  const revalidator = useRevalidator();
  const [searchParams] = useSearchParams();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [senderDialogOpen, setSenderDialogOpen] = useState(false);

  const filters = useMemo(() => parseSourceFilters(searchParams), [searchParams]);
  const filteredSources = useMemo(() => filterSources(sources, filters), [sources, filters]);
  const hasActiveFilters = Boolean(
    filters.q || filters.kind.length > 0 || filters.status.length > 0,
  );

  const pendingCount = useMemo(
    () => sources.filter((s) => s.status === "pending" || s.status === "fetching").length,
    [sources],
  );

  // Soft-poll while fetches are in flight.
  useEffect(() => {
    if (pendingCount === 0) return;
    const timer = setInterval(() => revalidator.revalidate(), 3000);
    return () => clearInterval(timer);
  }, [pendingCount, revalidator]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-content-primary">{t("sources.title")}</h1>
          <p className="mt-1 text-sm text-content-secondary">{t("sources.subtitle")}</p>
        </div>
        <button
          type="button"
          disabled={chatSenders.samples.length === 0}
          onClick={() => setSenderDialogOpen(true)}
          className="shrink-0 rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-content-secondary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t("sources.configure_senders")}
        </button>
      </header>

      <AddSourceSection sources={sources} assignableChapters={assignableChapters} />

      {sources.length === 0 ? (
        <p className="text-sm text-content-tertiary">{t("sources.empty")}</p>
      ) : (
        <>
          <SourcesToolbar sources={sources} />
          <SourceList
            sources={filteredSources}
            expanded={expanded}
            onToggle={(sourceId) =>
              setExpanded((prev) => ({ ...prev, [sourceId]: !prev[sourceId] }))
            }
            assignableChapters={assignableChapters}
            allChapters={allChapters}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            language={i18n.language}
            emptyMessage={
              hasActiveFilters || filters.view === "archived"
                ? t("sources.empty_filtered")
                : t("sources.empty")
            }
          />
        </>
      )}
      <ChatSenderDialog
        open={senderDialogOpen}
        onOpenChange={setSenderDialogOpen}
        profiles={chatSenders.profiles}
        samples={chatSenders.samples}
      />
    </div>
  );
}
