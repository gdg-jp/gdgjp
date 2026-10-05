import {
  Card,
  EmptyState,
  FormField,
  Icons,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  ToggleGroup,
  ToggleGroupItem,
} from "@gdgjp/design-system";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "~/components/page-header";
import { actOnChapters, loadChapters } from "~/features/chapters/chapters.server";
import { ChapterRow } from "~/features/chapters/components/chapter-row";
import { PageShell } from "~/layouts/page-shell";
import type { RouteData } from "~/lib/route-data";
import type { Route } from "./+types/chapters";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export function loader(args: Route.LoaderArgs) {
  return loadChapters(args);
}

export function action(args: Route.ActionArgs) {
  return actOnChapters(args);
}

type PageProps = {
  loaderData: RouteData<typeof loadChapters>;
  actionData?: RouteData<typeof actOnChapters>;
};

type ChapterFilter = "all" | "joinable" | "mine" | "pending";

export default function ChaptersPage({ loaderData }: PageProps) {
  const { t } = useTranslation();
  const { user, items } = loaderData;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChapterFilter>("all");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(({ chapter, state }) => {
      const matchesQuery =
        !q || chapter.name.toLowerCase().includes(q) || chapter.slug.toLowerCase().includes(q);
      const matchesFilter =
        filter === "all" ||
        (filter === "joinable" && state === "joinable") ||
        (filter === "pending" && state === "pending") ||
        (filter === "mine" && (state === "active-member" || state === "active-organizer"));
      return matchesQuery && matchesFilter;
    });
  }, [filter, items, query]);
  const filters: { value: ChapterFilter; label: string }[] = [
    { value: "all", label: t("chapters.filters.all") },
    { value: "joinable", label: t("chapters.filters.joinable") },
    { value: "mine", label: t("chapters.filters.mine") },
    { value: "pending", label: t("chapters.filters.pending") },
  ];
  return (
    <PageShell user={user} size="lg">
      <PageHeader title={t("chapters.title")} />

      {items.length === 0 ? (
        <Card className="mt-6">
          <EmptyState
            title={t("chapters.empty.title")}
            description={t("chapters.empty.description")}
          />
        </Card>
      ) : (
        <>
          <div className="mt-8 space-y-4">
            <FormField
              id="chapters-search"
              label={t("chapters.search.ariaLabel")}
              hideLabel
              className="max-w-xl gap-0"
            >
              <InputGroup>
                <InputGroupAddon>
                  <Icons name="Search" size={16} aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("chapters.search.placeholder")}
                />
              </InputGroup>
            </FormField>
            <ToggleGroup
              type="single"
              role="radiogroup"
              value={filter}
              onValueChange={(value) => {
                if (value) setFilter(value as ChapterFilter);
              }}
              aria-label={t("chapters.filters.ariaLabel")}
              className="flex-wrap"
            >
              {filters.map((item) => (
                <ToggleGroupItem key={item.value} value={item.value}>
                  {item.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          {filtered.length === 0 ? (
            <Card className="mt-4">
              <EmptyState
                title={t("chapters.search.noMatches")}
                description={t("chapters.search.noMatchesDescription")}
              />
            </Card>
          ) : (
            <div className="mt-4 divide-y rounded-xl border border-border bg-surface">
              {filtered.map(({ chapter, state }) => (
                <ChapterRow key={chapter.id} chapter={chapter} state={state} />
              ))}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
