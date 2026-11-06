import { Button, Card, EmptyState, Heading, Icons, Stack, Text } from "@gdgjp/design-system";
import { useEffect, useState } from "react";
import { latestBrief } from "~/features/briefs/brief.repository.server";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import { constants, channelLabel } from "~/features/playbook/playbook";
import { describeCondition, pendingConditions } from "~/features/schedule/blocked-by";
import { buildCalendar, jstDate } from "~/features/schedule/calendar";
import { ItemDialog } from "~/features/schedule/components/ItemDialog";
import { ItemRow } from "~/features/schedule/components/ItemRow";
import type { ScheduleItem } from "~/features/schedule/item";
import { type ItemFormErrors, parseItemForm } from "~/features/schedule/item-form";
import {
  createItem,
  deleteItem,
  listItems,
  updateItem,
} from "~/features/schedule/item.repository.server";
import { CampaignLayout } from "~/layouts/CampaignLayout";
import { useHydrated } from "~/lib/use-hydrated";
import type { Route } from "./+types/calendar";

export function meta() {
  return [{ title: "スケジュール — GDG PR" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const [items, stored] = await Promise.all([
    listItems(env.DB, access.campaign.id),
    latestBrief(env.DB, access.campaign.id),
  ]);
  const brief = stored?.brief ?? null;
  const status = new Map(items.map((i) => [i.id, i.status]));
  const now = Date.now();
  const pending = Object.fromEntries(
    items.map((item) => [
      item.id,
      pendingConditions(item.blockedBy, { brief, itemStatus: (id) => status.get(id), now }).map(
        (c) => describeCondition(c, brief),
      ),
    ]),
  );
  const { campaign } = access;
  return {
    user: { name: access.user.name, email: access.user.email, image: access.user.image },
    accountsUrl: env.ACCOUNTS_URL,
    campaign: {
      slug: campaign.slug,
      name: campaign.name,
      status: campaign.status,
      chapterSlug: campaign.chapterSlug,
    },
    eventDate: campaign.eventAt ? jstDate(campaign.eventAt) : null,
    items,
    pending,
    members: access.members.map((m) => ({ value: m.userId, label: m.name })),
    sessions: (brief?.sessions ?? []).map((s) => ({ value: s.id, label: s.title })),
    speakers: (brief?.speakers ?? []).map((s) => ({ value: s.id, label: s.name })),
    channels: constants.channelCatalog.map((c) => ({ value: c, label: channelLabel(c) })),
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const form = await request.formData();
  const intent = form.get("intent");
  const id = Number(form.get("id"));
  if (intent === "delete") {
    await deleteItem(env.DB, access.campaign.id, id);
    return { ok: true as const };
  }
  const parsed = parseItemForm(form);
  if (!parsed.ok) return { ok: false as const, errors: parsed.errors, intent };
  if (intent === "update") {
    const {
      kind,
      channel,
      dueAt,
      title,
      note,
      assigneeUserId,
      reviewerUserId,
      blockedBy,
      requestStatus,
      requestFollowupAt,
      speakerId,
      sessionId,
      variant,
      status,
    } = parsed.input;
    await updateItem(env.DB, access.campaign.id, id, {
      kind,
      channel: channel ?? null,
      dueAt,
      title,
      note: note ?? null,
      assigneeUserId: assigneeUserId ?? null,
      reviewerUserId: reviewerUserId ?? null,
      blockedBy: blockedBy ?? [],
      requestStatus: requestStatus ?? null,
      requestFollowupAt: requestFollowupAt ?? null,
      speakerId: speakerId ?? null,
      sessionId: sessionId ?? null,
      variant: variant ?? null,
      status,
    });
    return { ok: true as const };
  }
  const brief = (await latestBrief(env.DB, access.campaign.id))?.brief ?? null;
  await createItem(env.DB, access.campaign.id, parsed.input, brief);
  return { ok: true as const };
}

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];
function dayLabel(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}（${WEEKDAY[d.getUTCDay()]}）`;
}

export default function Calendar({ loaderData, actionData }: Route.ComponentProps) {
  const {
    user,
    accountsUrl,
    campaign,
    items,
    pending,
    members,
    sessions,
    speakers,
    channels,
    eventDate,
  } = loaderData;
  const [editing, setEditing] = useState<ScheduleItem | null>(null);
  const [open, setOpen] = useState(false);
  const hydrated = useHydrated();
  const weeks = buildCalendar(items as ScheduleItem[]);
  const people = Object.fromEntries(members.map((m) => [m.value, m.label]));
  const errors: ItemFormErrors =
    actionData && !actionData.ok && "errors" in actionData ? actionData.errors : {};
  // Keep the dialog open to show field errors; close it once a save succeeds.
  useEffect(() => {
    if (!actionData) return;
    setOpen(!actionData.ok && "errors" in actionData);
  }, [actionData]);
  const openFor = (item: ScheduleItem | null) => {
    setEditing(item);
    setOpen(true);
  };
  return (
    <CampaignLayout
      user={user}
      accountsUrl={accountsUrl}
      campaign={campaign}
      title="スケジュール"
      actions={
        <Button disabled={!hydrated} onClick={() => openFor(null)}>
          <Icons name="Plus" size={16} aria-hidden="true" />
          アイテムを追加
        </Button>
      }
    >
      {eventDate ? (
        <Text tone="muted">
          本番 {dayLabel(eventDate)}。灰色のアイテムは告知開始の条件を待っています。
        </Text>
      ) : null}
      {weeks.length === 0 ? (
        <Card>
          <EmptyState
            title="アイテムがありません"
            description="投稿・告知・依頼を日時つきで並べます。"
          />
        </Card>
      ) : (
        <Stack>
          {weeks.map((week) => (
            <Card key={week.weekOf}>
              <Stack>
                <Heading level={2} className="text-base">
                  {dayLabel(week.weekOf)} の週
                </Heading>
                {week.days.map((day) => (
                  <section key={day.date} aria-label={dayLabel(day.date)} className="space-y-2">
                    <h3
                      className={`text-sm font-semibold ${day.date === eventDate ? "text-primary" : ""}`}
                    >
                      {dayLabel(day.date)}
                      {day.date === eventDate ? " 本番" : ""}
                    </h3>
                    <ul className="space-y-2">
                      {day.rows.map((row) => (
                        <li key={row.item.id} className="list-none space-y-2">
                          <ul className="space-y-2">
                            <ItemRow
                              item={row.item}
                              pending={pending[row.item.id] ?? []}
                              people={people}
                              onEdit={openFor}
                            />
                            {row.children.map((child) => (
                              <ItemRow
                                key={child.id}
                                item={child}
                                derived
                                pending={pending[child.id] ?? []}
                                people={people}
                                onEdit={openFor}
                              />
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
      <ItemDialog
        open={open}
        onOpenChange={setOpen}
        item={editing}
        members={members}
        sessions={sessions}
        speakers={speakers}
        channels={channels}
        errors={errors}
      />
    </CampaignLayout>
  );
}
