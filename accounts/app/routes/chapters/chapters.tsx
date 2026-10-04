import { Button, Card, FormField, Heading, Icons, Input, Stack, Text } from "@gdgjp/design-system";
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
          <Stack>
            <Heading level={2} className="text-base">
              {t("chapters.empty.title")}
            </Heading>
            <Text tone="muted">{t("chapters.empty.description")}</Text>
          </Stack>
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
              <div className="relative">
                <Icons
                  name="Search"
                  size={16}
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("chapters.search.placeholder")}
                  className="w-full pl-9"
                />
              </div>
            </FormField>
            <fieldset className="flex gap-2 overflow-x-auto pb-1">
              <legend className="sr-only">{t("chapters.filters.ariaLabel")}</legend>
              {filters.map((item) => (
                <Button
                  key={item.value}
                  type="button"
                  variant={filter === item.value ? "primary" : "outline"}
                  size="sm"
                  aria-pressed={filter === item.value}
                  onClick={() => setFilter(item.value)}
                  className="shrink-0"
                >
                  {item.label}
                </Button>
              ))}
            </fieldset>
          </div>
          {filtered.length === 0 ? (
            <Card className="mt-4">
              <Stack>
                <Heading level={2} className="text-base">
                  {t("chapters.search.noMatches")}
                </Heading>
                <Text tone="muted">{t("chapters.search.noMatchesDescription")}</Text>
              </Stack>
            </Card>
          ) : (
            <div className="mt-4 divide-y overflow-x-auto rounded-xl border border-border bg-surface">
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
