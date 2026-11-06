import { Button, Card, FormField, Heading, Input, Stack, Text } from "@gdgjp/design-system";
import { Form } from "react-router";

type Props = { ideas: { segmentId: string; idea: string }[]; hasPlan: boolean; busy: boolean };

/** The plan's connpass work: the page job, the survey, and sub-events from segment ideas. */
export function ConnpassPlanCard({ ideas, hasPlan, busy }: Props) {
  return (
    <Card>
      <Stack>
        <Heading level={2} className="text-lg">
          connpass
        </Heading>
        <Form method="post" className="flex flex-wrap gap-2">
          <Button
            type="submit"
            name="intent"
            value="connpass-page"
            variant="outline"
            loading={busy}
          >
            connpass ページを作る
          </Button>
          <Button
            type="submit"
            name="intent"
            value="connpass-survey"
            variant="outline"
            loading={busy}
            disabled={!hasPlan}
          >
            アンケートを反映
          </Button>
        </Form>
        <Text tone="muted">
          メールはスケジュールの「connpass メール」を選んで runner
          に頼みます。承認しても、送るのは予定の時刻です。
        </Text>
        <Form method="post">
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <FormField
              label="サブイベントを作る"
              description="座談会・ハンズオンの申込枠（connpass にドラフトができます）"
            >
              <Input name="title" list="segment-ideas" />
            </FormField>
            <Button
              type="submit"
              name="intent"
              value="connpass-subevent"
              variant="outline"
              loading={busy}
            >
              作る
            </Button>
          </div>
          <datalist id="segment-ideas">
            {ideas.map((i) => (
              <option key={`${i.segmentId}-${i.idea}`} value={i.idea} />
            ))}
          </datalist>
        </Form>
      </Stack>
    </Card>
  );
}
