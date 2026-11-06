import {
  Badge,
  Button,
  Card,
  Checkbox,
  FormField,
  Heading,
  Input,
  Stack,
  Text,
} from "@gdgjp/design-system";
import { Form } from "react-router";

type Props = {
  configured: boolean;
  jobs: { jobId: string; kind: string; status: string; error: string | null }[];
  canManage: boolean;
  busy: boolean;
};

const TONE: Record<string, "success" | "danger" | "warning"> = {
  succeeded: "success",
  failed: "danger",
};

/** Thumbnail upload (1 MB), publishing (confirmed), and the connpass jobs pr submitted. */
export function ConnpassSettingsCard({ configured, jobs, canManage, busy }: Props) {
  return (
    <Card>
      <Stack>
        <Heading level={2} className="text-lg">
          connpass への反映
        </Heading>
        {!configured ? (
          <Text tone="muted">上で connpass のグループとイベント ID を入れると使えます。</Text>
        ) : null}
        <Form method="post" encType="multipart/form-data">
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <FormField label="サムネイル" description="PNG / JPEG / GIF、1 MB まで">
              <Input
                type="file"
                name="image"
                accept="image/png,image/jpeg,image/gif"
                disabled={!configured}
              />
            </FormField>
            <Button
              type="submit"
              name="intent"
              value="connpass-thumbnail"
              variant="outline"
              loading={busy}
              disabled={!configured}
            >
              上げる
            </Button>
          </div>
        </Form>
        {canManage ? (
          <Form method="post" className="flex flex-wrap items-center gap-3">
            <Checkbox id="confirm-publish" name="confirm" disabled={!configured} />
            <label htmlFor="confirm-publish">connpass のイベントを公開してよい</label>
            <Button
              type="submit"
              name="intent"
              value="connpass-publish"
              loading={busy}
              disabled={!configured}
            >
              公開
            </Button>
          </Form>
        ) : null}
        {jobs.length ? (
          <ul className="space-y-1 text-sm" aria-label="connpass のジョブ">
            {jobs.map((j) => (
              <li key={j.jobId} className="flex flex-wrap items-center gap-2">
                <Badge tone={TONE[j.status] ?? "warning"}>{j.status}</Badge>
                <span className="font-mono text-xs">{j.kind}</span>
                <span className="font-mono text-xs text-muted">{j.jobId}</span>
                {j.error ? <Text tone="muted">{j.error}</Text> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Stack>
    </Card>
  );
}
