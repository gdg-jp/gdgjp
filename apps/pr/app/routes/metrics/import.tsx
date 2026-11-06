import {
  Alert,
  Button,
  Card,
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
import { Form, useNavigation } from "react-router";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import {
  AD_FIELDS,
  AD_FIELD_LABELS,
  type AdField,
  type ColumnMap,
  REQUIRED_AD_FIELDS,
  guessColumnMap,
  parseCsv,
} from "~/features/metrics/csv";
import { columnMaps, importAdsCsv } from "~/features/metrics/import.server";
import { CampaignLayout } from "~/layouts/CampaignLayout";
import type { Route } from "./+types/import";

export function meta() {
  return [{ title: "広告 CSV — GDG PR" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
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
  };
}

type Step =
  | { step: "map"; source: string; csv: string; header: string[]; map: ColumnMap }
  | { step: "done"; message: string; alerts: string[]; problems: string[] }
  | { step: "error"; errors: string[] };

/** Two steps: upload (columns guessed, or the chapter's saved map applied) → confirm the map → import. */
export async function action({ request, context, params }: Route.ActionArgs): Promise<Step> {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const form = await request.formData();
  const source = String(form.get("source")) === "ig_ads_csv" ? "ig_ads_csv" : "x_ads_csv";
  if (form.get("intent") === "upload") {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size)
      return { step: "error", errors: ["CSV を選んでください"] };
    const csv = await file.text();
    const header = parseCsv(csv)[0] ?? [];
    const saved = (await columnMaps(env.DB, access.campaign.chapterId))[source] ?? {};
    const map = {
      ...guessColumnMap(header),
      ...Object.fromEntries(
        Object.entries(saved).filter(([, col]) => header.includes(col as string)),
      ),
    };
    return { step: "map", source, csv, header, map };
  }
  const map: ColumnMap = {};
  for (const field of AD_FIELDS) {
    const col = String(form.get(`col:${field}`) ?? "");
    if (col && col !== "__none__") map[field] = col;
  }
  const result = await importAdsCsv(env, access, {
    source,
    csv: String(form.get("csv") ?? ""),
    map,
  });
  return result.ok
    ? { step: "done", message: result.message, alerts: result.alerts, problems: result.problems }
    : { step: "error", errors: result.errors };
}

export default function ImportCsv({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, campaign } = loaderData;
  const busy = useNavigation().state === "submitting";
  return (
    <CampaignLayout
      user={user}
      accountsUrl={accountsUrl}
      campaign={campaign}
      title="広告の CSV を取り込む"
    >
      {actionData?.step === "error" ? (
        <Alert tone="danger" title="取り込めませんでした">
          {actionData.errors.join(" / ")}
        </Alert>
      ) : null}
      {actionData?.step === "done" ? (
        <Alert tone={actionData.alerts.length ? "warning" : "success"} title="取り込みました">
          {[actionData.message, ...actionData.alerts, ...actionData.problems].join(" / ")}
        </Alert>
      ) : null}
      {actionData?.step === "map" ? (
        <Card>
          <Form method="post">
            <Stack>
              <Heading level={2} className="text-lg">
                列の割り当て
              </Heading>
              <Text tone="muted">
                次回からはチャプターに保存した割り当てを使います。個人を特定できる列は割り当てません。
              </Text>
              <input type="hidden" name="source" value={actionData.source} />
              <input type="hidden" name="csv" value={actionData.csv} />
              <div className="grid gap-3 md:grid-cols-2">
                {AD_FIELDS.map((field: AdField) => (
                  <FormField
                    key={field}
                    label={AD_FIELD_LABELS[field]}
                    required={REQUIRED_AD_FIELDS.includes(field)}
                  >
                    <Select
                      name={`col:${field}`}
                      defaultValue={actionData.map[field] ?? "__none__"}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">（使わない）</SelectItem>
                        {actionData.header.map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                ))}
              </div>
              <div>
                <Button type="submit" name="intent" value="import" loading={busy}>
                  取り込む
                </Button>
              </div>
            </Stack>
          </Form>
        </Card>
      ) : (
        <Card>
          <Form method="post" encType="multipart/form-data">
            <Stack>
              <FormField label="媒体">
                <Select name="source" defaultValue="x_ads_csv">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="x_ads_csv">X 広告</SelectItem>
                    <SelectItem value="ig_ads_csv">Instagram 広告（Meta）</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="CSV ファイル">
                <Input type="file" name="file" accept=".csv,text/csv" />
              </FormField>
              <div>
                <Button type="submit" name="intent" value="upload" loading={busy}>
                  次へ
                </Button>
              </div>
            </Stack>
          </Form>
        </Card>
      )}
    </CampaignLayout>
  );
}
