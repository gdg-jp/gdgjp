import {
  Card,
  EmptyState,
  FormField,
  Heading,
  Icons,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Table,
} from "@gdgjp/design-system";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "~/components/page-header";
import {
  actOnAdminRequests,
  loadAdminRequests,
} from "~/features/memberships/admin-requests.server";
import { RequestCard, RequestRow } from "~/features/memberships/components/request-row";
import { PageShell } from "~/layouts/page-shell";
import type { RouteData } from "~/lib/route-data";
import type { Route } from "./+types/admin.requests";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export function loader(args: Route.LoaderArgs) {
  return loadAdminRequests(args);
}

export function action(args: Route.ActionArgs) {
  return actOnAdminRequests(args);
}

type PageProps = {
  loaderData: RouteData<typeof loadAdminRequests>;
  actionData?: RouteData<typeof actOnAdminRequests>;
};

export default function AdminRequests({ loaderData }: PageProps) {
  const { t } = useTranslation();
  const { user, requests, locale, now } = loaderData;
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return requests;
    return requests.filter((request) =>
      [request.user.name, request.user.email, request.chapter.name, request.chapter.slug]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalized)),
    );
  }, [query, requests]);
  return (
    <PageShell user={user} size="lg">
      <PageHeader title={t("adminRequests.title")} />

      {requests.length > 0 ? (
        <FormField
          id="admin-requests-search"
          label={t("adminRequests.searchPlaceholder")}
          hideLabel
          className="mt-6 max-w-xl gap-0"
        >
          <InputGroup>
            <InputGroupAddon>
              <Icons name="Search" size={16} aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("adminRequests.searchPlaceholder")}
            />
          </InputGroup>
        </FormField>
      ) : null}

      <Card className="mt-6">
        <Heading level={2}>{t("adminRequests.title")}</Heading>
        <div className="mt-6">
          {requests.length === 0 ? (
            <EmptyState title={t("adminRequests.empty")} />
          ) : filtered.length === 0 ? (
            <EmptyState title={t("adminRequests.noMatches")} />
          ) : (
            <>
              <ul className="divide-y md:hidden">
                {filtered.map((request) => (
                  <RequestCard
                    key={`${request.userId}-${request.chapterId}`}
                    req={request}
                    locale={locale}
                    now={now}
                  />
                ))}
              </ul>
              <div className="hidden md:block">
                <Table scrollLabel={t("common.tableScroll")}>
                  <thead>
                    <tr>
                      <th scope="col">{t("adminRequests.tableRequester")}</th>
                      <th scope="col">{t("adminRequests.tableChapter")}</th>
                      <th scope="col">{t("adminRequests.tableRequested")}</th>
                      <th scope="col" className="text-right">
                        {t("adminRequests.tableActions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <RequestRow
                        key={`${r.userId}-${r.chapterId}`}
                        req={r}
                        locale={locale}
                        now={now}
                      />
                    ))}
                  </tbody>
                </Table>
              </div>
            </>
          )}
        </div>
      </Card>
    </PageShell>
  );
}
