import { Badge, Button, Card, FormField, Heading, Input, Stack, Text } from "@gdgjp/design-system";
import { Form } from "react-router";
import type { DeliveryView } from "../delivery.server";

const TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  scheduled: "success",
  done: "success",
  failed: "danger",
  pending: "warning",
  delegated: "neutral",
  skipped: "neutral",
};

/** Per-account delivery of an approved post: each target is approved by its own chapter. */
export function DeliveryCard({ view, busy }: { view: DeliveryView; busy: boolean }) {
  return (
    <Card>
      <Stack>
        <Heading level={2} className="text-lg">
          配信
        </Heading>
        <Text tone="muted">
          承認した本文を、配信先ごとにそのチャプターのメンバーが承認すると sns に {view.at}{" "}
          で予約します。{view.shortUrl ? `短縮リンク: ${view.shortUrl}` : null}
        </Text>
        {!view.dispatchable ? (
          <Text tone="muted">下書きを承認すると配信先が並びます。</Text>
        ) : view.targets.length === 0 ? (
          <Text tone="muted">配信先の X アカウントがありません。設定で追加してください。</Text>
        ) : (
          <ul className="space-y-2" aria-label="配信先">
            {view.targets.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t.label}</span>
                <Badge tone={TONE[t.status] ?? "neutral"}>{t.statusLabel}</Badge>
                {t.snsPostId ? <Text tone="muted">sns: {t.snsPostId}</Text> : null}
                {t.error ? <Badge tone="danger">{t.error}</Badge> : null}
                {t.status === "pending" || t.status === "failed" ? (
                  <Form method="post" className="ml-auto flex gap-2">
                    <input type="hidden" name="target" value={t.id} />
                    {t.canApprove ? (
                      <Button
                        type="submit"
                        name="intent"
                        value="target-approve"
                        loading={busy}
                        size="sm"
                      >
                        {t.status === "failed" ? "再試行" : `${t.label} で予約`}
                      </Button>
                    ) : (
                      <Text tone="muted">そのチャプターのメンバーが承認します</Text>
                    )}
                    <Button
                      type="submit"
                      name="intent"
                      value="target-delegate"
                      variant="outline"
                      size="sm"
                      loading={busy}
                    >
                      依頼に回す
                    </Button>
                    <Button
                      type="submit"
                      name="intent"
                      value="target-skip"
                      variant="ghost"
                      size="sm"
                      loading={busy}
                    >
                      見送る
                    </Button>
                  </Form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <Form method="post">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <FormField
              label="リンク先"
              description="{{shortlink}} の宛先。空なら brief の connpass URL"
            >
              <Input name="linkUrl" defaultValue={view.linkUrl ?? ""} />
            </FormField>
            <FormField
              label="OGP 画像の URL"
              description={
                view.attachmentKind === "ogp" ? "OGP カードの投稿は必須" : "OGP カードにするとき"
              }
            >
              <Input name="ogImage" defaultValue={view.ogImage ?? ""} />
            </FormField>
            <Button type="submit" name="intent" value="link" variant="outline" loading={busy}>
              リンクを保存
            </Button>
          </div>
        </Form>
        <Form method="post">
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <FormField label="添付する画像の URL" description="予約時に sns に添付します">
              <Input name="mediaUrl" defaultValue={view.mediaUrl ?? ""} />
            </FormField>
            <div className="flex gap-2">
              <Button type="submit" name="intent" value="media" variant="outline" loading={busy}>
                画像を保存
              </Button>
              <input type="hidden" name="templateId" value="x-post-16x9" />
              <Button
                type="submit"
                name="intent"
                value="make-image"
                variant="outline"
                loading={busy}
              >
                画像を作る
              </Button>
            </div>
          </div>
        </Form>
      </Stack>
    </Card>
  );
}
