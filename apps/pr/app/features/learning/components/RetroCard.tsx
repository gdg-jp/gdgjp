import { Button, Card, FormField, Heading, Stack, Text, Textarea } from "@gdgjp/design-system";
import { Form } from "react-router";

/** Settings: the team's KPT notes (read by the retro) and "振り返る". */
export function RetroNotesCard({ notes, busy }: { notes: string; busy: boolean }) {
  return (
    <Card>
      <Form method="post">
        <Stack>
          <Heading level={2} className="text-lg">
            振り返り
          </Heading>
          <FormField
            label="振り返りメモ（KPT）"
            description="Keep / Problem / Try をそのまま貼る。終了にすると振り返りのジョブが自動で積まれます"
          >
            <Textarea name="retroNotes" rows={6} defaultValue={notes} />
          </FormField>
          <div className="flex gap-2">
            <Button
              type="submit"
              name="intent"
              value="retro-notes"
              variant="outline"
              loading={busy}
            >
              メモを保存
            </Button>
            <Button type="submit" name="intent" value="retro" loading={busy}>
              振り返る
            </Button>
          </div>
        </Stack>
      </Form>
    </Card>
  );
}

/** The retro report: what to paste into the Wiki (pr never writes it), and what was refused. */
export function RetroReportCard({
  content,
}: { content: { reportMd: string; wikiOutreachUpdateMd: string; refused: string[] } }) {
  return (
    <Card>
      <Stack>
        <Heading level={2} className="text-lg">
          振り返り
        </Heading>
        <pre className="whitespace-pre-wrap text-sm">{content.reportMd}</pre>
        <div className="flex items-center gap-2">
          <Heading level={3} className="text-base">
            Wiki に貼る（イベント告知対象とコネクション保有者）
          </Heading>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void navigator.clipboard?.writeText(content.wikiOutreachUpdateMd)}
          >
            コピー
          </Button>
        </div>
        <pre className="whitespace-pre-wrap text-sm" aria-label="Wiki に貼る更新">
          {content.wikiOutreachUpdateMd}
        </pre>
        {content.refused.length ? (
          <Text tone="muted">取り込まなかった提案: {content.refused.join(" / ")}</Text>
        ) : null}
        <Text tone="muted">提案は /playbook/proposals で採用か却下を決めます。</Text>
      </Stack>
    </Card>
  );
}
