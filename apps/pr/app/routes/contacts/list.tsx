import {
  Alert,
  Badge,
  Button,
  Card,
  FormField,
  Heading,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Table,
  Text,
} from "@gdgjp/design-system";
import { ClaimsUnavailableError } from "@gdgjp/gdg-lib";
import { Form, useNavigation } from "react-router";
import { requireUserWithChapter } from "~/features/auth/access.server";
import {
  CONTACT_KINDS,
  CONTACT_KIND_LABELS,
  type ContactKind,
  organizationKey,
} from "~/features/contacts/contact";
import {
  createManualContact,
  deleteManualContact,
  listContacts,
  syncWikiContacts,
} from "~/features/contacts/contact.repository.server";
import { duplicateOrganizations, parseOutreachPage } from "~/features/contacts/wiki-import";
import { WikiReadError, wikiReaderForRequest } from "~/features/contacts/wiki.server";
import { AppLayout } from "~/layouts/AppLayout";
import type { Route } from "./+types/list";

export function meta() {
  return [{ title: "告知先 — GDG PR" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, request);
  const contacts = await listContacts(
    env.DB,
    chapters.map((c) => c.chapterId),
  );
  const duplicates = duplicateOrganizations(contacts);
  return {
    user: { name: user.name, email: user.email, image: user.image },
    accountsUrl: env.ACCOUNTS_URL,
    chapters: chapters.map((c) => ({ id: c.chapterId, slug: c.chapterSlug })),
    wikiTitle: env.WIKI_OUTREACH_TITLE,
    contacts: contacts.map((c) => ({ ...c, duplicate: duplicates.has(c.organization) })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { chapters } = await requireUserWithChapter(env, request);
  const ids = chapters.map((c) => c.chapterId);
  const form = await request.formData();
  const intent = form.get("intent");
  const chapterId = Number(form.get("chapterId") ?? ids[0]);
  if (!ids.includes(chapterId)) return { message: null, error: "所属していないチャプターです" };
  if (intent === "import") {
    try {
      const wiki = await wikiReaderForRequest(env, request);
      const path = await wiki.findPage(env.WIKI_OUTREACH_TITLE);
      if (!path)
        return {
          message: null,
          error: `Wiki に「${env.WIKI_OUTREACH_TITLE}」が見つからないか、読む権限がありません`,
        };
      const imported = parseOutreachPage(await wiki.readPage(path));
      if (imported.length === 0)
        return {
          message: null,
          error: "ページから告知先を読み取れませんでした（見出しの形を確認してください）",
        };
      const result = await syncWikiContacts(env.DB, chapterId, path, imported);
      return {
        message: `${result.upserted} 件を取り込み、${result.removed} 件を消しました（${path}）`,
        error: null,
      };
    } catch (error) {
      if (error instanceof ClaimsUnavailableError)
        return { message: null, error: "Wiki を読むにはもう一度サインインしてください" };
      if (error instanceof WikiReadError)
        return { message: null, error: `Wiki を読めませんでした（${error.status} ${error.code}）` };
      throw error;
    }
  }
  if (intent === "manual") {
    const name = String(form.get("name") ?? "").trim();
    const kind = String(form.get("kind")) as ContactKind;
    if (!name || !CONTACT_KINDS.includes(kind))
      return { message: null, error: "名前と種類を入れてください" };
    await createManualContact(env.DB, {
      chapterId,
      organization: organizationKey(name),
      kind,
      name,
      relation: String(form.get("relation") ?? "").trim() || null,
      channel: String(form.get("channel") ?? "").trim() || null,
      notes: null,
    });
    return { message: "追加しました", error: null };
  }
  if (intent === "delete") {
    await deleteManualContact(env.DB, ids, Number(form.get("id")));
    return { message: null, error: null };
  }
  return { message: null, error: null };
}

export default function Contacts({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, chapters, contacts, wikiTitle } = loaderData;
  const navigation = useNavigation();
  const chapterChoice = (
    <FormField label="チャプター">
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
  );
  return (
    <AppLayout user={user} accountsUrl={accountsUrl}>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader
          title="告知先"
          description={`正本は Wiki の「${wikiTitle}」。ここは誰が・いつ・どこに頼んだかの運用表です。`}
        />
        {actionData?.error ? (
          <Alert tone="danger" title="できませんでした">
            {actionData.error}
          </Alert>
        ) : null}
        {actionData?.message ? (
          <Alert tone="success" title="完了">
            {actionData.message}
          </Alert>
        ) : null}
        <Card>
          <Form method="post" className="grid gap-3 md:grid-cols-[14rem_auto] md:items-end">
            <input type="hidden" name="intent" value="import" />
            {chapterChoice}
            <Button
              type="submit"
              loading={
                navigation.state === "submitting" && navigation.formData?.get("intent") === "import"
              }
            >
              Wiki から取り込む
            </Button>
          </Form>
        </Card>
        <Card>
          <Stack>
            <Heading level={2} className="text-lg">
              一覧（{contacts.length}）
            </Heading>
            {contacts.length === 0 ? (
              <Text tone="muted">まだありません。Wiki から取り込んでください。</Text>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>名前</th>
                    <th>種類</th>
                    <th>Wiki の担当</th>
                    <th>注意</th>
                    <th>
                      <span className="sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{CONTACT_KIND_LABELS[c.kind]}</td>
                      <td>{c.wikiPerson ?? (c.manual ? "手入力" : "担当未記載")}</td>
                      <td>{c.duplicate ? <Badge tone="warning">重複連絡注意</Badge> : null}</td>
                      <td>
                        {c.manual ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="delete" />
                            <input type="hidden" name="id" value={c.id} />
                            <Button size="sm" variant="ghost" type="submit">
                              消す
                            </Button>
                          </Form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Stack>
        </Card>
        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="manual" />
            <Stack>
              <Heading level={2} className="text-lg">
                手で追加（Wiki に無いもの）
              </Heading>
              <div className="grid gap-3 md:grid-cols-2">
                {chapterChoice}
                <FormField label="名前" required>
                  <Input name="name" />
                </FormField>
                <FormField label="種類" required>
                  <Select name="kind" defaultValue="community">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTACT_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {CONTACT_KIND_LABELS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="関係" description="誰のつてか">
                  <Input name="relation" />
                </FormField>
                <FormField label="連絡手段" description="連絡先そのものは書かない">
                  <Input name="channel" />
                </FormField>
              </div>
              <div className="flex justify-end">
                <Button type="submit" variant="outline">
                  追加
                </Button>
              </div>
            </Stack>
          </Form>
        </Card>
      </Stack>
    </AppLayout>
  );
}
