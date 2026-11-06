import { Button, Card, FormField, Heading, Input, Stack, Text } from "@gdgjp/design-system";
import { Form } from "react-router";

type Props = {
  platform: string;
  fields: { label: string; value: string }[];
  approved: boolean;
  busy: boolean;
};

/** A listing's fields to paste (and the "listed by hand" step while no automation exists). */
export function ListingCard({ platform, fields, approved, busy }: Props) {
  const all = fields.map((f) => `${f.label}: ${f.value}`).join("\n");
  return (
    <Card>
      <Stack>
        <div className="flex flex-wrap items-center gap-2">
          <Heading level={2} className="text-lg">
            {platform} の掲載内容
          </Heading>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void navigator.clipboard?.writeText(all)}
          >
            全部コピー
          </Button>
        </div>
        <dl className="grid gap-2 md:grid-cols-[8rem_1fr]">
          {fields.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-sm text-muted">{f.label}</dt>
              <dd className="whitespace-pre-wrap text-sm">{f.value}</dd>
            </div>
          ))}
        </dl>
        <Text tone="muted">
          直すときは下の JSON を編集して新しい版にします（HTML は入れない）。
        </Text>
        {approved ? (
          <Form method="post">
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <FormField label="掲載した URL" description="手で掲載したとき">
                <Input name="url" type="url" />
              </FormField>
              <Button
                type="submit"
                name="intent"
                value="listing-manual"
                variant="outline"
                loading={busy}
              >
                手で掲載した
              </Button>
            </div>
          </Form>
        ) : null}
      </Stack>
    </Card>
  );
}
