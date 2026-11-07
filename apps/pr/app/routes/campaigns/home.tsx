import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmptyState,
  FormField,
  Icons,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  PageHeader,
  Stack,
} from "@gdgjp/design-system";
import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { campaignState } from "~/features/assistant/state.server";
import { requireUserWithChapter } from "~/features/auth/access.server";
import { STATUS_LABELS } from "~/features/campaigns/campaign";
import { listCampaignsForChapters } from "~/features/campaigns/campaign.repository.server";
import { createCampaignFromForm } from "~/features/campaigns/creation.server";
import { jstDate } from "~/features/schedule/calendar";
import { AppLayout } from "~/layouts/AppLayout";
import { useHydrated } from "~/lib/use-hydrated";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "イベント — GDG PR" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { chapter } = await requireUserWithChapter(env, request);
  const campaigns = await listCampaignsForChapters(env.DB, [chapter.chapterId]);
  return {
    campaigns: await Promise.all(
      campaigns.map(async (c) => {
        const { state } = c.status === "closed" ? { state: null } : await campaignState(env, c);
        return {
          slug: c.slug,
          name: c.name,
          status: c.status,
          eventDate: c.eventAt ? jstDate(c.eventAt) : null,
          venue: c.venue,
          isPreEvent: c.parentCampaignId !== null,
          applications: state?.applications ?? null,
          gaps: state?.brief.gaps ?? [],
          waiting: state ? state.drafts.filter((d) => d.status !== "generating").length : 0,
        };
      }),
    ),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { user, chapter } = await requireUserWithChapter(env, request);
  return createCampaignFromForm(env, request, user, chapter);
}

const TONE = { draft: "neutral", active: "success", closed: "info" } as const;

export default function Events({ loaderData, actionData }: Route.ComponentProps) {
  const { campaigns } = loaderData;
  const [creating, setCreating] = useState(false);
  const navigation = useNavigation();
  const hydrated = useHydrated();
  const createButton = (
    <Button disabled={!hydrated} onClick={() => setCreating(true)}>
      <Icons name="Plus" size={16} aria-hidden="true" />
      イベントを追加
    </Button>
  );
  return (
    <AppLayout>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader
          title="イベント"
          description="イベントごとに、秘書が集客を手伝います。"
          actions={campaigns.length ? createButton : undefined}
        />
        {campaigns.length === 0 ? (
          <Card>
            <EmptyState
              title="イベントがありません"
              description="イベント名を決めて追加すると、秘書がイベントページや資料を読んで準備を始めます。"
              action={createButton}
            />
          </Card>
        ) : (
          <ItemGroup>
            {campaigns.map((c) => (
              <Item key={c.slug} variant="outline" className="relative">
                <ItemMedia>
                  <Icons
                    name={c.isPreEvent ? "CalendarDays" : "Radio"}
                    size={20}
                    aria-hidden="true"
                  />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>
                    <Link to={`/c/${c.slug}`} className="after:absolute after:inset-0">
                      {c.name}
                    </Link>
                  </ItemTitle>
                  <ItemDescription>
                    {[
                      c.eventDate ?? "日付未定",
                      c.venue,
                      c.isPreEvent ? "プレイベント" : null,
                      c.applications
                        ? `申込 ${c.applications.count} / ${c.applications.goal}`
                        : null,
                      c.gaps.length && c.status !== "closed"
                        ? `足りない情報: ${c.gaps.join("、")}`
                        : null,
                      c.waiting ? `返事待ち ${c.waiting} 件` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Badge tone={TONE[c.status]}>{STATUS_LABELS[c.status]}</Badge>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
      </Stack>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogTitle>イベントを追加</DialogTitle>
          <DialogDescription>
            名前は仮でかまいません。追加したら、秘書にイベントページや資料の URL を貼ってください。
          </DialogDescription>
          <Form method="post" noValidate>
            <Stack>
              <FormField label="イベント名" required error={actionData?.errors?.name}>
                <Input name="name" maxLength={120} autoFocus />
              </FormField>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setCreating(false)}>
                  キャンセル
                </Button>
                <Button type="submit" loading={navigation.state === "submitting"}>
                  追加
                </Button>
              </div>
            </Stack>
          </Form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
