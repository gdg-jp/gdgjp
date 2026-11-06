import {
  Badge,
  Button,
  Card,
  Checkbox,
  FormField,
  Heading,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Table,
  Text,
} from "@gdgjp/design-system";
import { Form } from "react-router";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import { MEMBER_ROLES, MEMBER_ROLE_LABELS, type MemberRole } from "~/features/campaigns/campaign";
import {
  addCoHost,
  listKnownUsers,
  removeCoHost,
  removeMember,
  upsertMember,
} from "~/features/campaigns/campaign.repository.server";
import { CampaignLayout } from "~/layouts/CampaignLayout";
import type { Route } from "./+types/members";

export function meta() {
  return [{ title: "メンバー — GDG PR" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const users = access.permissions.manage ? await listKnownUsers(env.DB) : [];
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
    members: access.members,
    chapters: access.campaignChapters,
    users: users.filter((u) => !access.members.some((m) => m.userId === u.id)),
    myChapters: access.chapters.map((c) => ({ id: c.chapterId, slug: c.chapterSlug })),
    canManage: access.permissions.manage,
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug, "manage");
  const form = await request.formData();
  const intent = form.get("intent");
  const id = access.campaign.id;
  if (intent === "member") {
    const userId = String(form.get("userId") ?? "");
    const known =
      (await listKnownUsers(env.DB)).find((u) => u.id === userId) ??
      access.members.find((m) => m.userId === userId);
    if (!known)
      return { error: "ユーザーが見つかりません（一度 pr にサインインした人だけ追加できます）" };
    const roles = form
      .getAll("roles")
      .filter((r): r is MemberRole => MEMBER_ROLES.includes(r as MemberRole));
    await upsertMember(
      env.DB,
      id,
      {
        userId,
        name: known.name,
        email: known.email,
        roles,
        discordHandle: String(form.get("discord") ?? "").trim() || null,
      },
      access.user.id,
    );
  } else if (intent === "remove-member") {
    await removeMember(env.DB, id, String(form.get("userId")));
  } else if (intent === "co-host") {
    const chapterId = Number(form.get("chapterId"));
    const chapterSlug = String(form.get("chapterSlug") ?? "").trim();
    if (!Number.isInteger(chapterId) || chapterId <= 0 || !chapterSlug)
      return { error: "チャプター ID と名前を入れてください" };
    if (chapterId === access.campaign.chapterId) return { error: "主催チャプターです" };
    await addCoHost(env.DB, id, chapterId, chapterSlug);
  } else if (intent === "remove-co-host") {
    await removeCoHost(env.DB, id, Number(form.get("chapterId")));
  }
  return { error: null };
}

export default function Members({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, campaign, members, chapters, users, myChapters, canManage } =
    loaderData;
  return (
    <CampaignLayout user={user} accountsUrl={accountsUrl} campaign={campaign} title="メンバー">
      {actionData?.error ? <Text className="text-danger">{actionData.error}</Text> : null}
      <Card>
        <Stack>
          <Heading level={2} className="text-lg">
            主催・共催チャプター
          </Heading>
          <Text tone="muted">
            共催チャプターのメンバーもこのキャンペーンを見て、スケジュールや下書きを扱えます。
          </Text>
          <ul className="space-y-1">
            {chapters.map((c) => (
              <li key={c.chapterId} className="flex items-center gap-2">
                <Badge tone={c.role === "host" ? "success" : "neutral"}>
                  {c.role === "host" ? "主催" : "共催"}
                </Badge>
                {c.chapterSlug}（ID {c.chapterId}）
                {canManage && c.role === "co-host" ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="remove-co-host" />
                    <input type="hidden" name="chapterId" value={c.chapterId} />
                    <Button size="sm" variant="ghost" type="submit">
                      外す
                    </Button>
                  </Form>
                ) : null}
              </li>
            ))}
          </ul>
          {canManage ? (
            <Form method="post" className="grid gap-3 md:grid-cols-[10rem_1fr_auto] md:items-end">
              <input type="hidden" name="intent" value="co-host" />
              <FormField label="チャプター ID">
                <Input name="chapterId" inputMode="numeric" />
              </FormField>
              <FormField
                label="チャプター名"
                description={`例: ${myChapters.map((c) => `${c.id} ${c.slug}`).join(" / ")}`}
              >
                <Input name="chapterSlug" />
              </FormField>
              <Button type="submit" variant="outline">
                共催に追加
              </Button>
            </Form>
          ) : null}
        </Stack>
      </Card>
      <Card>
        <Stack>
          <Heading level={2} className="text-lg">
            メンバーと役割
          </Heading>
          <Table>
            <thead>
              <tr>
                <th>名前</th>
                <th>役割</th>
                <th>Discord</th>
                <th>
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId}>
                  <td>
                    {m.name}
                    <div className="text-xs text-muted">{m.email}</div>
                  </td>
                  <td>
                    {canManage ? (
                      <Form
                        method="post"
                        id={`member-${m.userId}`}
                        className="flex flex-wrap gap-x-3 gap-y-1"
                      >
                        <input type="hidden" name="intent" value="member" />
                        <input type="hidden" name="userId" value={m.userId} />
                        <input type="hidden" name="discord" value={m.discordHandle ?? ""} />
                        {MEMBER_ROLES.map((role) => (
                          <span key={role} className="inline-flex items-center gap-1 text-sm">
                            <Checkbox
                              id={`role-${m.userId}-${role}`}
                              name="roles"
                              value={role}
                              defaultChecked={m.roles.includes(role)}
                            />
                            <label htmlFor={`role-${m.userId}-${role}`}>
                              {MEMBER_ROLE_LABELS[role]}
                            </label>
                          </span>
                        ))}
                      </Form>
                    ) : (
                      m.roles.map((r) => MEMBER_ROLE_LABELS[r]).join("、")
                    )}
                  </td>
                  <td>{m.discordHandle ?? ""}</td>
                  <td>
                    {canManage ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          type="submit"
                          form={`member-${m.userId}`}
                        >
                          保存
                        </Button>
                        <Form method="post">
                          <input type="hidden" name="intent" value="remove-member" />
                          <input type="hidden" name="userId" value={m.userId} />
                          <Button size="sm" variant="ghost" type="submit">
                            外す
                          </Button>
                        </Form>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {canManage ? (
            <Form method="post" className="grid gap-3 md:grid-cols-[1fr_12rem_auto] md:items-end">
              <input type="hidden" name="intent" value="member" />
              <FormField label="追加する人" description="一度 pr にサインインした人を選べます">
                <Select name="userId">
                  <SelectTrigger>
                    <SelectValue placeholder="選ぶ" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}（{u.email}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Discord のハンドル">
                <Input name="discord" />
              </FormField>
              <Button type="submit" variant="outline">
                追加
              </Button>
            </Form>
          ) : null}
        </Stack>
      </Card>
    </CampaignLayout>
  );
}
