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
} from "@gdgjp/design-system";
import { toast } from "@gdgjp/design-system";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import { PageHeader } from "~/components/page-header";
import { StatusBadge } from "~/features/memberships/components/status-badge";
import type { UserSummary } from "~/features/users/repository.server";
import { PageShell } from "~/layouts/page-shell";
import type { actOnChapterManagement, loadChapterManagement } from "../management.server";
type LoaderData = Awaited<ReturnType<typeof loadChapterManagement>>;
export function userLabel(users: Record<string, UserSummary>, id: string) {
  const user = users[id];
  if (!user) return { name: id, email: "" };
  return { name: user.name || user.email || id, email: user.name ? user.email : "" };
}

type PendingMember = LoaderData["pending"][number];
type ChapterMember = LoaderData["members"][number];
type RowFetcher = ReturnType<typeof useFetcher<typeof actOnChapterManagement>>;
type MemberIntent = "promote" | "demote" | "remove";

function useToastError(fetcher: RowFetcher) {
  const { t } = useTranslation();
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.error) return;
    toast.error(fetcher.data.error, { description: t("organize.errorTitle") });
  }, [fetcher.data, fetcher.state, t]);
}

function Person({ name, email }: { name: string; email: string }) {
  return (
    <div className="min-w-0">
      <Text className="truncate font-medium">{name}</Text>
      {email ? (
        <Text size="xs" tone="muted" className="truncate">
          {email}
        </Text>
      ) : null}
    </div>
  );
}

function ConfirmMemberAction({
  fetcher,
  userId,
  name,
  intent,
  compact = false,
}: {
  fetcher: RowFetcher;
  userId: string;
  name: string;
  intent: MemberIntent;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const isPending = fetcher.state !== "idle" && fetcher.formData?.get("intent") === intent;
  const config = {
    promote: {
      label: t("organize.promote"),
      title: t("organize.dialog.promoteTitle", { name }),
      description: t("organize.dialog.promoteDescription"),
      confirm: t("organize.promote"),
      variant: "primary" as const,
    },
    demote: {
      label: t("organize.demote"),
      title: t("organize.dialog.demoteTitle", { name }),
      description: t("organize.dialog.demoteDescription"),
      confirm: t("organize.demote"),
      variant: "outline" as const,
    },
    remove: {
      label: t("organize.remove"),
      title: t("organize.dialog.removeTitle", { name }),
      description: t("organize.dialog.removeDescription"),
      confirm: t("organize.remove"),
      variant: "danger" as const,
    },
  }[intent];

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={config.variant}
          size={compact ? "sm" : "md"}
          disabled={fetcher.state !== "idle"}
          fullWidth={compact}
          className={compact ? "justify-start" : undefined}
        >
          {config.label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <Stack className="gap-2">
          <AlertDialogTitle>{config.title}</AlertDialogTitle>
          <AlertDialogDescription>{config.description}</AlertDialogDescription>
        </Stack>
        <div className="flex flex-wrap justify-end gap-3">
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={isPending}>
              {t("organize.dialog.cancel")}
            </Button>
          </AlertDialogCancel>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value={intent} />
            <input type="hidden" name="userId" value={userId} />
            <AlertDialogAction asChild>
              <Button type="submit" variant={config.variant} loading={isPending}>
                {config.confirm}
              </Button>
            </AlertDialogAction>
          </fetcher.Form>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PendingRow({
  member,
  users,
}: {
  member: PendingMember;
  users: Record<string, UserSummary>;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof actOnChapterManagement>();
  useToastError(fetcher);
  const user = userLabel(users, member.userId);
  const isApproving = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "approve";
  const isRejecting = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "remove";
  return (
    <li className="organize-pending-row grid gap-3 rounded-lg border p-4 sm:items-center sm:rounded-none sm:border-x-0 sm:border-t-0 sm:px-0">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
          <Icons name="User" size={16} aria-hidden="true" />
        </div>
        <Person {...user} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="approve" />
          <input type="hidden" name="userId" value={member.userId} />
          <Button type="submit" fullWidth size="sm" loading={isApproving}>
            {isApproving ? null : <Icons name="Check" size={16} aria-hidden="true" />}
            {t("organize.approve")}
          </Button>
        </fetcher.Form>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={fetcher.state !== "idle"}
              fullWidth
            >
              <Icons name="X" size={16} aria-hidden="true" /> {t("organize.reject")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <Stack className="gap-2">
              <AlertDialogTitle>
                {t("organize.dialog.rejectTitle", { name: user.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("organize.dialog.rejectDescription")}
              </AlertDialogDescription>
            </Stack>
            <div className="flex flex-wrap justify-end gap-3">
              <AlertDialogCancel asChild>
                <Button type="button" variant="outline" disabled={isRejecting}>
                  {t("organize.dialog.cancel")}
                </Button>
              </AlertDialogCancel>
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="remove" />
                <input type="hidden" name="userId" value={member.userId} />
                <AlertDialogAction asChild>
                  <Button type="submit" variant="danger" loading={isRejecting}>
                    {t("organize.reject")}
                  </Button>
                </AlertDialogAction>
              </fetcher.Form>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}

function MemberActions({
  member,
  name,
  fetcher,
  isCurrentUser,
  compact,
}: {
  member: ChapterMember;
  name: string;
  fetcher: RowFetcher;
  isCurrentUser: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const isOrganizer = member.role === "organizer";
  if (isCurrentUser) {
    return (
      <Text size="xs" tone="muted">
        {t("organize.currentUser")}
      </Text>
    );
  }
  return (
    <div className={compact ? "grid gap-2" : "flex flex-wrap justify-end gap-2"}>
      <ConfirmMemberAction
        fetcher={fetcher}
        userId={member.userId}
        name={name}
        intent={isOrganizer ? "demote" : "promote"}
        compact={compact}
      />
      <ConfirmMemberAction
        fetcher={fetcher}
        userId={member.userId}
        name={name}
        intent="remove"
        compact={compact}
      />
    </div>
  );
}

export function MemberRow({
  member,
  users,
  viewerId,
}: {
  member: ChapterMember;
  users: Record<string, UserSummary>;
  viewerId: string;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof actOnChapterManagement>();
  useToastError(fetcher);
  const user = userLabel(users, member.userId);
  const isOrganizer = member.role === "organizer";
  return (
    <li className="organize-member-row grid gap-4 rounded-lg border p-4 sm:items-center sm:rounded-none sm:border-x-0 sm:border-t-0 sm:px-0">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral text-muted">
          <Icons name="User" size={16} aria-hidden="true" />
        </div>
        <Person {...user} />
      </div>
      <StatusBadge status={isOrganizer ? "organizer" : "member"}>
        {isOrganizer ? t("organize.organizerBadge") : t("organize.memberBadge")}
      </StatusBadge>
      <MemberActions
        member={member}
        name={user.name}
        fetcher={fetcher}
        isCurrentUser={member.userId === viewerId}
      />
    </li>
  );
}
