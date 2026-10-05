import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  FormField,
  Heading,
  Icons,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Stack,
  Table,
  Text,
  toast,
} from "@gdgjp/design-system";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, useFetcher } from "react-router";
import { PageHeader } from "~/components/page-header";
import { actOnUserAdmin, loadUserAdmin } from "~/features/users/admin.server";
import { UserActions } from "~/features/users/components/user-actions";
import { pageUrl } from "~/features/users/page-url";
import { PageShell } from "~/layouts/page-shell";
import type { Route } from "./+types/admin.users";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export function loader(args: Route.LoaderArgs) {
  return loadUserAdmin(args);
}

export function action(args: Route.ActionArgs) {
  return actOnUserAdmin(args);
}

type LoaderData = Awaited<ReturnType<typeof loadUserAdmin>>;

type ManagedUser = LoaderData["users"][number];

function initials(name: string, email: string) {
  const value = name.trim() || email;
  return value.slice(0, 2).toUpperCase();
}

function formatCreatedAt(value: number | string, locale: string) {
  const numeric = typeof value === "number" ? value : Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export default function AdminUsers({ loaderData }: { loaderData: LoaderData }) {
  const { t } = useTranslation();
  const { users, total, page, pageSize, query, locale, user, chapters } = loaderData;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <PageShell user={user} size="lg">
      <PageHeader title={t("adminUsers.title")} />

      <Form method="get" className="mt-6 flex flex-col gap-2 sm:flex-row">
        <FormField
          id="admin-users-search"
          label={t("adminUsers.searchPlaceholder")}
          hideLabel
          className="flex-1 gap-0"
        >
          <InputGroup>
            <InputGroupAddon>
              <Icons name="Search" size={16} aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              name="q"
              defaultValue={query}
              placeholder={t("adminUsers.searchPlaceholder")}
            />
          </InputGroup>
        </FormField>
        <Button type="submit">{t("adminUsers.search")}</Button>
        {query ? (
          <Button asChild variant="outline">
            <Link to="/admin/users">{t("adminUsers.clear")}</Link>
          </Button>
        ) : null}
      </Form>

      <Text size="sm" tone="muted" className="mt-4 flex items-center justify-between">
        <span>{t("adminUsers.resultCount", { count: total })}</span>
        <span>{t("adminUsers.page", { page, pages })}</span>
      </Text>

      <Card className="mt-3 overflow-hidden p-0">
        {users.length === 0 ? (
          <EmptyState title={t("adminUsers.empty")} />
        ) : (
          <>
            <ul className="divide-y md:hidden">
              {users.map((item) => (
                <li key={item.id} className="space-y-4 p-4">
                  <div className="flex items-start gap-3">
                    <Avatar
                      src={item.image ?? undefined}
                      alt={item.name || item.email}
                      fallback={initials(item.name, item.email)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{item.name || item.email}</div>
                      <div className="truncate text-xs text-muted">{item.email}</div>
                    </div>
                    <Badge tone={item.isAdmin ? "success" : "neutral"}>
                      {item.isAdmin ? t("adminUsers.adminBadge") : t("adminUsers.userBadge")}
                    </Badge>
                  </div>
                  <dl className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted">{t("adminUsers.table.memberships")}</dt>
                      <dd className="mt-1">
                        {t("adminUsers.activeMemberships", {
                          active: item.activeMembershipCount,
                          total: item.membershipCount,
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">{t("adminUsers.table.sessions")}</dt>
                      <dd className="mt-1 tabular-nums">{item.sessionCount}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">{t("adminUsers.table.created")}</dt>
                      <dd className="mt-1">{formatCreatedAt(item.createdAt, locale)}</dd>
                    </div>
                  </dl>
                  <UserActions item={item} actorId={user.id} chapters={chapters} />
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <Table scrollLabel={t("common.tableScroll")}>
                <thead>
                  <tr>
                    <th scope="col">{t("adminUsers.table.user")}</th>
                    <th scope="col">{t("adminUsers.table.memberships")}</th>
                    <th scope="col">{t("adminUsers.table.sessions")}</th>
                    <th scope="col">{t("adminUsers.table.created")}</th>
                    <th scope="col">{t("adminUsers.table.role")}</th>
                    <th scope="col" className="text-right">
                      {t("adminUsers.table.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="flex min-w-56 items-center gap-3">
                          <Avatar
                            src={item.image ?? undefined}
                            alt={item.name || item.email}
                            fallback={initials(item.name, item.email)}
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{item.name || item.email}</div>
                            <div className="truncate text-xs text-muted">{item.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-sm text-muted">
                        {t("adminUsers.activeMemberships", {
                          active: item.activeMembershipCount,
                          total: item.membershipCount,
                        })}
                      </td>
                      <td className="tabular-nums">{item.sessionCount}</td>
                      <td className="whitespace-nowrap text-sm text-muted">
                        {formatCreatedAt(item.createdAt, locale)}
                      </td>
                      <td>
                        <Badge tone={item.isAdmin ? "success" : "neutral"}>
                          {item.isAdmin ? t("adminUsers.adminBadge") : t("adminUsers.userBadge")}
                        </Badge>
                      </td>
                      <td>
                        <UserActions item={item} actorId={user.id} chapters={chapters} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </Card>

      <div className="mt-4 flex justify-end gap-2">
        {page <= 1 ? (
          <Button variant="outline" size="sm" disabled>
            {t("adminUsers.previous")}
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link to={pageUrl(query, page - 1)}>{t("adminUsers.previous")}</Link>
          </Button>
        )}
        {page >= pages ? (
          <Button variant="outline" size="sm" disabled>
            {t("adminUsers.next")}
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link to={pageUrl(query, page + 1)}>{t("adminUsers.next")}</Link>
          </Button>
        )}
      </div>
    </PageShell>
  );
}
