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
  Text,
} from "@gdgjp/design-system";
import { Form, Link } from "react-router";
import type { deliverySettings } from "../settings.server";

type Props = {
  data: Awaited<ReturnType<typeof deliverySettings>>;
  status: string;
  canManage: boolean;
  busy: boolean;
};

const HEALTH: Record<
  string,
  { tone: "success" | "warning" | "danger" | "neutral"; label: string }
> = {
  ok: { tone: "success", label: "正常" },
  warning: { tone: "warning", label: "1 回失敗" },
  broken: { tone: "danger", label: "リンク切れ" },
  unknown: { tone: "neutral", label: "未確認" },
};

/** Accounts per chapter, the posting precheck, activation, reminders and link health. */
export function DeliverySettings({ data, status, canManage, busy }: Props) {
  return (
    <>
      <Card>
        <Stack>
          <Heading level={2} className="text-lg">
            配信先アカウント
          </Heading>
          <Text tone="muted">
            主催と共催のアカウントを並べます。各アカウントへの投稿は、そのチャプターのメンバーが承認したときだけ
            sns に予約されます。
          </Text>
          <ul className="space-y-2" aria-label="配信先アカウント">
            {data.accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{a.kind}</Badge>
                <span className="font-medium">{a.label}</span>
                <Text tone="muted">
                  {a.chapterSlug}
                  {a.role === "primary" ? "（主催）" : ""}
                </Text>
                {a.check?.warning ? <Badge tone="danger">{a.check.warning}</Badge> : null}
                {a.check && !a.check.warning ? (
                  <Badge tone="success">投稿できる人: {a.check.posters.join("、")}</Badge>
                ) : null}
                {canManage ? (
                  <Form method="post" className="ml-auto">
                    <input type="hidden" name="account" value={a.id} />
                    <Button
                      type="submit"
                      name="intent"
                      value="remove-account"
                      variant="ghost"
                      size="sm"
                      loading={busy}
                    >
                      外す
                    </Button>
                  </Form>
                ) : null}
              </li>
            ))}
          </ul>
          {data.addable.length ? (
            <Form method="post">
              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <FormField
                  label="X アカウントを追加"
                  description="sns に接続済みの、自分のチャプターのアカウント"
                >
                  <Select
                    name="account"
                    defaultValue={`${data.addable[0]?.chapterId}|${data.addable[0]?.id}|${data.addable[0]?.username}`}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {data.addable.map((a) => (
                        <SelectItem key={a.id} value={`${a.chapterId}|${a.id}|${a.username}`}>
                          @{a.username}（{a.chapterSlug}）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <Button type="submit" name="intent" value="add-x" loading={busy}>
                  追加
                </Button>
              </div>
            </Form>
          ) : null}
          <Form method="post">
            <div className="grid gap-3 md:grid-cols-[10rem_1fr_10rem_auto] md:items-end">
              <FormField label="種類">
                <Select name="kind" defaultValue="ig">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ig">Instagram</SelectItem>
                    <SelectItem value="connpass_group">connpass グループ</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="ハンドル">
                <Input name="handle" />
              </FormField>
              <FormField label="チャプター">
                <Select name="chapter" defaultValue={String(data.chapters[0]?.id ?? "")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {data.chapters.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.slug}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <Button
                type="submit"
                name="intent"
                value="add-handle"
                variant="outline"
                loading={busy}
              >
                追加
              </Button>
            </div>
          </Form>
        </Stack>
      </Card>
      <Card>
        <Stack>
          <Heading level={2} className="text-lg">
            有効化とリマインド
          </Heading>
          <Text tone="muted">
            有効化すると url.gdgs.jp
            にキャンペーンと広報手段ごとのチャネルを作り、告知中にします。何度押しても同じものを使います。
            {data.channels.length ? ` チャネル ${data.channels.length} 本。` : ""}
          </Text>
          {canManage ? (
            <Form method="post">
              <Button type="submit" name="intent" value="activate" loading={busy}>
                {status === "active" ? "もう一度有効化（チャネルを揃える）" : "有効化"}
              </Button>
            </Form>
          ) : null}
          <Form method="post" className="flex flex-wrap items-center gap-3">
            <Checkbox
              id="auto-reminders"
              name="auto"
              defaultChecked={data.autoStaffReminders}
              disabled={!canManage}
            />
            <label htmlFor="auto-reminders">
              スタッフへの依頼を時刻どおりに自動で Discord に送る
            </label>
            {canManage ? (
              <Button
                type="submit"
                name="intent"
                value="auto-reminders"
                variant="outline"
                size="sm"
                loading={busy}
              >
                保存
              </Button>
            ) : null}
          </Form>
          <Text tone="muted">
            Discord: {data.webhook ?? "未設定"}（
            <Link to="/settings/chapter" className="text-link">
              チャプター設定
            </Link>
            ）
          </Text>
        </Stack>
      </Card>
      <Card>
        <Stack>
          <Heading level={2} className="text-lg">
            短縮リンク
          </Heading>
          {data.links.length === 0 ? (
            <Text tone="muted">まだありません。投稿を承認すると作られます。</Text>
          ) : null}
          <ul className="space-y-1 text-sm" aria-label="短縮リンク">
            {data.links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={HEALTH[l.health]?.tone ?? "neutral"}>{HEALTH[l.health]?.label}</Badge>
                <span className="font-mono">{l.shortUrl}</span>
                <Text tone="muted">→ {l.destinationUrl}</Text>
              </li>
            ))}
          </ul>
          {data.log.length ? (
            <details>
              <summary className="cursor-pointer text-sm">配信の記録</summary>
              <ul className="mt-2 space-y-1 font-mono text-xs">
                {data.log.map((e, i) => (
                  <li key={`${e.at}-${i}`}>
                    {e.ok ? "✓" : "✗"} {e.action} {e.detail ?? ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Stack>
      </Card>
    </>
  );
}
