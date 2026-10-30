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
import { createProjectFromForm } from "~/features/projects/creation.server";
import { listProjectsForChapters } from "~/features/projects/projects.server";
import { AdminLayout } from "~/layouts/AdminLayout";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "プロジェクト — GDG Roulette" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, request);
  const projects = await listProjectsForChapters(
    env.DB,
    chapters.map((c) => c.chapterId),
  );
  return {
    user: { name: user.name, email: user.email, image: user.image },
    accountsUrl: env.ACCOUNTS_URL,
    host: new URL(env.APP_URL).host,
    chapters: chapters.map((c) => ({ id: c.chapterId, slug: c.chapterSlug })),
    projects,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  return createProjectFromForm(context.cloudflare.env, request);
}

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, host, chapters, projects } = loaderData;
  const [creating, setCreating] = useState(false);
  const navigation = useNavigation();
  // The dialog stays open on errors: only a successful create redirects away.
  const errors = actionData?.errors ?? {};
  const createButton = (
    <Button onClick={() => setCreating(true)}>
      <Icons name="Plus" size={16} aria-hidden="true" />
      プロジェクトを作成
    </Button>
  );
  return (
    <AdminLayout user={user} accountsUrl={accountsUrl}>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader title="プロジェクト" actions={projects.length ? createButton : undefined} />
        {projects.length === 0 ? (
          <Card>
            <EmptyState
              title="プロジェクトがありません"
              description="景品の抽選ごとにプロジェクトを作ると、来場者向けの抽選画面の URL ができます。"
              action={createButton}
            />
          </Card>
        ) : (
          <ItemGroup>
            {projects.map((project) => (
              <Item key={project.slug} variant="outline" className="relative">
                <ItemMedia>
                  <Icons name="LoaderPinwheel" size={20} aria-hidden="true" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>
                    <Link to={`/admin/${project.slug}`} className="after:absolute after:inset-0">
                      {project.name}
                    </Link>
                  </ItemTitle>
                  <ItemDescription>
                    {host}/{project.slug} · 景品 {project.prizeCount} 種 · 抽選 {project.draws} 回 ·{" "}
                    {project.chapterSlug}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Badge tone={project.open ? "success" : "neutral"}>
                    {project.open ? "受付中" : "停止中"}
                  </Badge>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
      </Stack>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogTitle>プロジェクトを作成</DialogTitle>
          <DialogDescription>抽選画面の URL は、作成したあとは変えられません。</DialogDescription>
          <Form method="post" noValidate>
            <Stack>
              <FormField label="プロジェクト名" required error={errors.name}>
                <Input name="name" maxLength={80} />
              </FormField>
              <FormField
                label="URL"
                required
                description="英小文字・数字・ハイフン"
                error={errors.slug}
              >
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>{host}/</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    name="slug"
                    autoCapitalize="off"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </InputGroup>
              </FormField>
              {chapters.length > 1 ? (
                <FormField label="チャプター" required error={errors.chapter}>
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
    </AdminLayout>
  );
}
