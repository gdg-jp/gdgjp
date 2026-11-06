import { Badge, Button, Card, Heading, Stack, Text } from "@gdgjp/design-system";
import { Form } from "react-router";
import type { RequestRow } from "../requests.server";

const KIND_LABEL: Record<RequestRow["kind"], string> = {
  staff_reminder: "スタッフへの依頼",
  speaker_request: "登壇者への依頼",
  request: "外部への依頼",
};

const REQUEST_LABEL: Record<string, string> = {
  sent: "送った",
  replied: "返事あり",
  declined: "断られた",
};

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
}

/** Staff reminders to send, speaker requests to copy and send by hand, outreach replies. */
export function RequestsCard({ rows, busy }: { rows: RequestRow[]; busy: boolean }) {
  return (
    <Card>
      <Stack>
        <Heading level={2} className="text-lg">
          依頼と送信
        </Heading>
        {rows.length === 0 ? <Text tone="muted">送るものはありません。</Text> : null}
        <ul className="space-y-4" aria-label="依頼">
          {rows.map((r) => (
            <li key={r.id} className="space-y-2 border-b border-border pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{KIND_LABEL[r.kind]}</Badge>
                <span className="font-medium">{r.title}</span>
                <Text tone="muted">
                  {r.at}
                  {r.assignee ? ` · 担当 ${r.assignee}` : ""}
                </Text>
                {r.requestStatus ? (
                  <Badge tone="info">{REQUEST_LABEL[r.requestStatus]}</Badge>
                ) : null}
                {r.status === "failed" ? <Badge tone="danger">送信失敗</Badge> : null}
              </div>
              {r.text ? <pre className="whitespace-pre-wrap text-sm">{r.text}</pre> : null}
              <Form method="post" className="flex flex-wrap gap-2">
                <input type="hidden" name="item" value={r.id} />
                {r.text ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => copy(r.text)}>
                    コピー
                  </Button>
                ) : null}
                {r.kind === "staff_reminder" ? (
                  <Button
                    type="submit"
                    name="intent"
                    value="send-reminder"
                    size="sm"
                    loading={busy}
                  >
                    Discord に送信
                  </Button>
                ) : r.requestStatus === "sent" ? (
                  <>
                    <Button type="submit" name="intent" value="replied" size="sm" loading={busy}>
                      返事があった
                    </Button>
                    <Button
                      type="submit"
                      name="intent"
                      value="declined"
                      variant="ghost"
                      size="sm"
                      loading={busy}
                    >
                      断られた
                    </Button>
                  </>
                ) : (
                  <Button type="submit" name="intent" value="mark-sent" size="sm" loading={busy}>
                    送った
                  </Button>
                )}
              </Form>
            </li>
          ))}
        </ul>
      </Stack>
    </Card>
  );
}
