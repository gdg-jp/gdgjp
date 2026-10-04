import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Card,
  FormField,
  Heading,
  Icons,
  Input,
  Stack,
  Text,
  toast,
} from "@gdgjp/design-system";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import { PageHeader } from "~/components/page-header";
import { MemberRow, PendingRow, userLabel } from "~/features/memberships/components/member-rows";
import { StatusBadge } from "~/features/memberships/components/status-badge";
import {
  actOnChapterManagement,
  loadChapterManagement,
} from "~/features/memberships/management.server";
import type { UserSummary } from "~/features/users/repository.server";
import { PageShell } from "~/layouts/page-shell";
import type { Route } from "./+types/chapters.$slug.organize";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export function loader(args: Route.LoaderArgs) {
  return loadChapterManagement(args);
}

export function action(args: Route.ActionArgs) {
  return actOnChapterManagement(args);
}

type LoaderData = Awaited<ReturnType<typeof loadChapterManagement>>;

export default function OrganizeChapter({ loaderData }: { loaderData: LoaderData }) {
  const { t } = useTranslation();
  const { user, chapter, pending, members, users } = loaderData;
  const [query, setQuery] = useState("");
  const filteredMembers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return members;
    return members.filter((member) => {
      const target = userLabel(users, member.userId);
      return `${target.name} ${target.email}`.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [members, query, users]);
  return (
    <PageShell user={user} size="lg">
      <PageHeader
        back={{ to: "/chapters", label: t("organize.back") }}
        title={t("organize.title", { chapter: chapter.name })}
      />

      <section aria-labelledby="pending-heading" className="mt-8">
        <Card className="overflow-hidden">
          <Stack>
            <Heading level={2} id="pending-heading">
              {t("organize.pending", { count: pending.length })}
            </Heading>
            <Text tone="muted">{t("organize.pendingDescription")}</Text>
          </Stack>
          <div className="mt-6">
            {pending.length === 0 ? (
              <Text size="sm" tone="muted">
                {t("organize.noPending")}
              </Text>
            ) : (
              <ul className="space-y-3 sm:space-y-0">
                {pending.map((member) => (
                  <PendingRow key={member.userId} member={member} users={users} />
                ))}
              </ul>
            )}
          </div>
        </Card>
      </section>

      <section aria-labelledby="members-heading" className="mt-8">
        <Card>
          <Stack>
            <Heading level={2} id="members-heading">
              {t("organize.members", { count: members.length })}
            </Heading>
            <Text tone="muted">{t("organize.membersDescription")}</Text>
          </Stack>
          <Stack className="mt-6">
            {members.length > 0 ? (
              <FormField
                id="organize-members-search"
                label={t("organize.search.ariaLabel")}
                hideLabel
                className="max-w-md gap-0"
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
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("organize.search.placeholder")}
                    className="w-full pl-9"
                  />
                </div>
              </FormField>
            ) : null}
            {members.length === 0 ? (
              <Text size="sm" tone="muted">
                {t("organize.noMembers")}
              </Text>
            ) : filteredMembers.length === 0 ? (
              <Text size="sm" tone="muted">
                {t("organize.search.noMatches")}
              </Text>
            ) : (
              <ul className="space-y-3 sm:space-y-0">
                {filteredMembers.map((member) => (
                  <MemberRow key={member.userId} member={member} users={users} viewerId={user.id} />
                ))}
              </ul>
            )}
          </Stack>
        </Card>
      </section>
    </PageShell>
  );
}
