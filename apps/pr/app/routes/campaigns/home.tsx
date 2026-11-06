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
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
} from "@gdgjp/design-system";
import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { requireUserWithChapter } from "~/features/auth/access.server";
import { STATUS_LABELS } from "~/features/campaigns/campaign";
import { listCampaignsForChapters } from "~/features/campaigns/campaign.repository.server";
import { createCampaignFromForm } from "~/features/campaigns/creation.server";
import { jstDate } from "~/features/schedule/calendar";
import { AppLayout } from "~/layouts/AppLayout";
import { useHydrated } from "~/lib/use-hydrated";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "キャンペーン — GDG PR" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, request);
  const campaigns = await listCampaignsForChapters(
    env.DB,
    chapters.map((c) => c.chapterId),
    user.isAdmin,
  );
  return {
    user: { name: user.name, email: user.email, image: user.image },
    accountsUrl: env.ACCOUNTS_URL,
    chapters: chapters.map((c) => ({ id: c.chapterId, slug: c.chapterSlug })),
    campaigns: campaigns.map((c) => ({
      slug: c.slug,
      name: c.name,
      status: c.status,
      chapterSlug: c.chapterSlug,
      eventDate: c.eventAt ? jstDate(c.eventAt) : null,
      venue: c.venue,
      isPreEvent: c.parentCampaignId !== null,
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, request);
  return createCampaignFromForm(env, request, user, chapters);
}

const TONE = { draft: "neutral", active: "success", closed: "info" } as const;

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, chapters, campaigns } = loaderData;
  const [creating, setCreating] = useState(false);
  const navigation = useNavigation();
  const errors = actionData && "errors" in actionData ? actionData.errors : {};
  const hydrated = useHydrated();
  const createButton = (
    <Button disabled={!hydrated} onClick={() => setCreating(true)}>
      <Icons name="Plus" size={16} aria-hidden="true" />
      キャンペーンを作成
    </Button>
  );
  return (
    <AppLayout user={user} accountsUrl={accountsUrl}>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader
          title="キャンペーン"
          description="1 つのイベントの集客を 1 つのキャンペーンで管理します。"
          actions={campaigns.length ? createButton : undefined}
        />
        {campaigns.length === 0 ? (
          <Card>
            <EmptyState
              title="キャンペーンがありません"
              description="イベントごとにキャンペーンを作ると、brief・スケジュール・下書きをまとめて扱えます。"
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
                      c.chapterSlug,
                      c.isPreEvent ? "プレイベント" : null,
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
          <DialogTitle>キャンペーンを作成</DialogTitle>
          <DialogDescription>作ったあと、brief にイベントの情報を入れます。</DialogDescription>
          <Form method="post" noValidate>
            <Stack>
              <FormField label="イベント名" required error={errors?.name}>
                <Input name="name" maxLength={120} />
              </FormField>
              <FormField
                label="URL"
                required
                description="英小文字・数字・ハイフン"
                error={errors?.slug}
              >
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>/c/</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    name="slug"
                    autoCapitalize="off"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </InputGroup>
              </FormField>
              <FormField label="開催日時" error={errors?.eventAt}>
                <Input name="eventAt" type="datetime-local" />
              </FormField>
              <FormField label="会場">
                <Input name="venue" />
              </FormField>
              <FormField label="予算の総額（円）" error={errors?.budget}>
                <Input name="budget" inputMode="numeric" defaultValue="0" />
              </FormField>
              <FormField
                label="本番のキャンペーン"
                description="プレイベントのときだけ、本番の URL（/c/ の後ろ）"
                error={errors?.parent}
              >
                <Input name="parent" autoCapitalize="off" />
              </FormField>
              {chapters.length > 1 ? (
                <FormField label="主催チャプター" required error={errors?.chapter}>
                  <Select name="chapterId" defaultValue={String(chapters[0]?.id ?? "")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {chapters.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.slug}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              ) : (
                <input type="hidden" name="chapterId" value={chapters[0]?.id} />
              )}
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setCreating(false)}>
                  キャンセル
                </Button>
                <Button type="submit" loading={navigation.state === "submitting"}>
                  作成
                </Button>
              </div>
            </Stack>
          </Form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
