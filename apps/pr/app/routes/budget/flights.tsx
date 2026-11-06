import {
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  Input,
  Stack,
  Table,
  Text,
} from "@gdgjp/design-system";
import { Form, useNavigation } from "react-router";
import { MEDIUM_LABELS, type Medium, overrun, xIgSplit } from "~/features/budget/flight";
import {
  deleteFlight,
  insertFlight,
  listFlights,
  updateFlight,
} from "~/features/budget/flight.repository.server";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import { constants } from "~/features/playbook/playbook";
import { fromJstLocal, jstDate } from "~/features/schedule/calendar";
import { CampaignLayout } from "~/layouts/CampaignLayout";
import type { Route } from "./+types/flights";

export function meta() {
  return [{ title: "広告フライト — GDG PR" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const { campaign } = access;
  const flights = await listFlights(env.DB, campaign.id);
  const now = Math.floor(Date.now() / 1000);
  return {
    user: { name: access.user.name, email: access.user.email, image: access.user.image },
    accountsUrl: env.ACCOUNTS_URL,
    campaign: {
      slug: campaign.slug,
      name: campaign.name,
      status: campaign.status,
      chapterSlug: campaign.chapterSlug,
    },
    flights: flights.map((f) => ({
      ...f,
      period: `${jstDate(f.startAt)} 〜 ${jstDate(f.endAt)}`,
      warning: overrun(f, constants.budget.overrunAlertRatio, now),
    })),
    split: xIgSplit(flights, constants.budget.xIgRatioRange, "plannedYen"),
    canManage: access.permissions.manage,
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug, "manage");
  const form = await request.formData();
  const id = Number(form.get("id"));
  if (form.get("intent") === "delete") {
    await deleteFlight(env.DB, access.campaign.id, id);
    return { message: "消しました" };
  }
  const plannedYen = Math.round(Number(form.get("plannedYen")));
  if (!Number.isFinite(plannedYen) || plannedYen < 0) return { message: "金額を入れてください" };
  if (form.get("intent") === "update") {
    await updateFlight(env.DB, access.campaign.id, id, { plannedYen });
    return { message: "更新しました" };
  }
  const medium = String(form.get("medium")) as Medium;
  const startAt = fromJstLocal(String(form.get("startAt") ?? ""));
  const endAt = fromJstLocal(String(form.get("endAt") ?? ""));
  if (!(medium in MEDIUM_LABELS) || !startAt || !endAt || endAt <= startAt)
    return { message: "媒体と期間を入れてください" };
  await insertFlight(env.DB, {
    campaignId: access.campaign.id,
    medium,
    name: String(form.get("name") ?? medium),
    startAt,
    endAt,
    plannedYen,
    phases: [],
    planVersion: null,
  });
  return { message: "追加しました" };
}

export default function Flights({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, campaign, flights, split, canManage } = loaderData;
  const busy = useNavigation().state === "submitting";
  return (
    <CampaignLayout user={user} accountsUrl={accountsUrl} campaign={campaign} title="広告フライト">
      {actionData?.message ? <Text tone="muted">{actionData.message}</Text> : null}
      {split.share !== null ? (
        <Badge tone={split.inRange ? "success" : "danger"}>
          計画の X : Instagram = {Math.round(split.share * 100)} :{" "}
          {100 - Math.round(split.share * 100)}（BUDGET-SPLIT {split.inRange ? "OK" : "範囲外"}）
        </Badge>
      ) : null}
      {flights.length === 0 ? (
        <Card>
          <EmptyState
            title="フライトがありません"
            description="計画を採用すると予算配分から作られます。手でも足せます。"
          />
        </Card>
      ) : (
        <Card>
          <Table aria-label="フライト">
            <thead>
              <tr>
                <th>媒体</th>
                <th>名前</th>
                <th>期間</th>
                <th>計画</th>
                <th>実績</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {flights.map((f) => (
                <tr key={f.id}>
                  <td>{MEDIUM_LABELS[f.medium]}</td>
                  <td>{f.name}</td>
                  <td>{f.period}</td>
                  <td>
                    <Form method="post" className="flex gap-2">
                      <input type="hidden" name="id" value={f.id} />
                      <Input
                        name="plannedYen"
                        aria-label={`${f.name} の計画額`}
                        defaultValue={String(f.plannedYen)}
                        disabled={!canManage}
                      />
                      {canManage ? (
                        <Button
                          type="submit"
                          name="intent"
                          value="update"
                          size="sm"
                          variant="outline"
                          loading={busy}
                        >
                          保存
                        </Button>
                      ) : null}
                    </Form>
                  </td>
                  <td>
                    {f.actualYen === null ? "—" : `${f.actualYen.toLocaleString("ja-JP")} 円`}
                    {f.warning ? <Badge tone="danger">{f.warning}</Badge> : null}
                  </td>
                  <td>
                    {canManage ? (
                      <Form method="post">
                        <input type="hidden" name="id" value={f.id} />
                        <Button
                          type="submit"
                          name="intent"
                          value="delete"
                          size="sm"
                          variant="ghost"
                          loading={busy}
                        >
                          消す
                        </Button>
                      </Form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {canManage ? (
        <Card>
          <Form method="post">
            <Stack>
              <div className="grid gap-3 md:grid-cols-5">
                <FormField label="媒体" description="x_ads / ig_ads / print">
                  <Input name="medium" defaultValue="ig_ads" />
                </FormField>
                <FormField label="名前">
                  <Input name="name" />
                </FormField>
                <FormField label="開始">
                  <Input name="startAt" type="datetime-local" />
                </FormField>
                <FormField label="終了">
                  <Input name="endAt" type="datetime-local" />
                </FormField>
                <FormField label="計画額（円）">
                  <Input name="plannedYen" inputMode="numeric" />
                </FormField>
              </div>
              <div>
                <Button type="submit" name="intent" value="create" variant="outline" loading={busy}>
                  フライトを足す
                </Button>
              </div>
            </Stack>
          </Form>
        </Card>
      ) : null}
    </CampaignLayout>
  );
}
