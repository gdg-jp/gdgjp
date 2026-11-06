import { Button, Card, FormField, Heading, Input, Stack, Text } from "@gdgjp/design-system";
import { Form } from "react-router";

const FIELDS = [
  { platform: "luma", label: "Luma カレンダー ID" },
  { platform: "techplay", label: "TECH PLAY 主催者 ID" },
  { platform: "bevy", label: "Bevy チャプター ID" },
] as const;

/** Where this campaign lists outside connpass (the connpass app's allowlists decide the rest). */
export function ListingTargetsCard({
  targets,
  busy,
  canManage,
}: { targets: Record<string, string>; busy: boolean; canManage: boolean }) {
  return (
    <Card>
      <Form method="post">
        <Stack>
          <Heading level={2} className="text-lg">
            ほかの媒体の掲載先
          </Heading>
          <Text tone="muted">
            自動掲載は connpass
            アプリ側の準備（媒体ごとの方式の確認）が済むまで使えません。それまでは掲載文をコピーして手で掲載します。
          </Text>
          <div className="grid gap-3 md:grid-cols-3">
            {FIELDS.map((f) => (
              <FormField key={f.platform} label={f.label}>
                <Input
                  name={`listing:${f.platform}`}
                  defaultValue={targets[f.platform] ?? ""}
                  disabled={!canManage}
                />
              </FormField>
            ))}
          </div>
          {canManage ? (
            <div>
              <Button
                type="submit"
                name="intent"
                value="listing-targets"
                variant="outline"
                loading={busy}
              >
                掲載先を保存
              </Button>
            </div>
          ) : null}
        </Stack>
      </Form>
    </Card>
  );
}
