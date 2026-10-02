import {
  Button,
  Card,
  Checkbox,
  FormField,
  Heading,
  Input,
  Link,
  NativeSelect,
  NativeSelectOption,
  PageHeader,
  Stack,
} from "@gdgjp/ui";
import { Form, Link as RouterLink, redirect, useNavigation } from "react-router";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { canManageEvent } from "~/features/auth/permissions";
import { getEvent } from "~/features/events/events.server";
import { RosterSheetCard } from "~/features/roster-sheets/components/RosterSheetCard";
import {
  archiveRosterSheet,
  reorderRosterSheets,
} from "~/features/roster-sheets/roster-sheet-lifecycle.server";
import {
  createRosterSheet,
  listRosterSheets,
  setRosterSheetVisibility,
} from "~/features/roster-sheets/roster-sheets.server";
import {
  DEFAULT_NAME,
  SUPPORTED_STEPS,
  type SheetFormErrors,
  type SheetFormValues,
  parseSheetForm,
} from "~/features/roster-sheets/sheet-form";
import { getDb } from "~/lib/db.server";
import type { Route } from "./+types/e.$id";

type ActionData = {
  values?: SheetFormValues;
  errors?: SheetFormErrors;
  formError?: string;
  reorderError?: string;
  sheetError?: { sheetId: string; intent: string; message: string };
};

function formValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.event.name} — シフト一覧 — roster` : "roster" }];
}

export async function action({
  request,
  context,
  params,
}: Route.ActionArgs): Promise<Response | ActionData> {
  const env = context.cloudflare.env;
  const { chapters } = await requireUserWithChapter(env, request);
  if (!params.id) throw new Response(null, { status: 404 });

  const db = getDb(env);
  const event = await getEvent(db, params.id);
  if (!event) throw new Response(null, { status: 404 });
  if (!canManageEvent(chapters, event)) throw new Response("Forbidden", { status: 403 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return {
      values: {
        name: DEFAULT_NAME,
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime,
        stepMin: String(event.stepMin),
        maxConsecutive: String(event.maxConsecutive),
        noSoloNewcomer: event.noSoloNewcomer,
      },
      errors: {},
      formError: "入力を読み取れませんでした。もう一度お試しください。",
    };
  }
  const intent = formValue(form, "intent");
  if (intent === "reorderSheets") {
    const submittedIds = form.getAll("sheetIds");
    if (!submittedIds.every((id): id is string => typeof id === "string" && id.length > 0)) {
      return {
        reorderError: "シフト表の一覧を読み取れませんでした。画面を更新してお試しください。",
      };
    }

    try {
      await reorderRosterSheets(db, event.id, submittedIds);
    } catch {
      return {
        reorderError:
          "シフト表一覧が更新されたため、並び順を変更できませんでした。画面を更新してお試しください。",
      };
    }
    return redirect(`/e/${event.id}`);
  }

  if (intent === "setVisibility" || intent === "archiveSheet") {
    const sheetId = formValue(form, "sheetId");
    const fail = (message: string) => ({ sheetError: { sheetId, intent, message } });
    if (!sheetId) return fail("シフト表を特定できませんでした。画面を更新してお試しください。");

    try {
      if (intent === "setVisibility") {
        const visibility = formValue(form, "visibility");
        if (visibility !== "private" && visibility !== "published") {
          return fail("公開状態を変更できませんでした。画面を更新してお試しください。");
        }
        await setRosterSheetVisibility(db, event.id, sheetId, visibility);
      } else {
        await archiveRosterSheet(db, event.id, sheetId);
      }
    } catch {
      return fail(
        intent === "archiveSheet"
          ? "シフト表をアーカイブできませんでした。対象を確認してお試しください。"
          : "公開状態を変更できませんでした。対象を確認してお試しください。",
      );
    }
    return redirect(`/e/${event.id}`);
  }

  if (intent !== "createSheet") {
    return { formError: "操作を読み取れませんでした。画面を更新してお試しください。" };
  }

  const { values, errors, input } = parseSheetForm(form);
  if (Object.keys(errors).length > 0) return { values, errors };

  try {
    await createRosterSheet(db, event.id, { ...input, seed: event.seed });
  } catch {
    return {
      values,
      errors: {},
      formError: "シフト表を作成できませんでした。入力を確認して再度お試しください。",
    };
  }

  return redirect(`/e/${event.id}`);
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { chapters } = await requireUserWithChapter(env, request);
  if (!params.id) throw new Response(null, { status: 404 });

  const db = getDb(env);
  const event = await getEvent(db, params.id);
  if (!event) throw new Response(null, { status: 404 });
  if (!canManageEvent(chapters, event)) throw new Response("Forbidden", { status: 403 });

  const sheets = await listRosterSheets(db, event.id);
  return {
    event: {
      id: event.id,
      name: event.name,
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      stepMin: event.stepMin,
      maxConsecutive: event.maxConsecutive,
      noSoloNewcomer: event.noSoloNewcomer,
      status: event.status,
    },
    sheets: sheets.map(({ id, name, date, startTime, endTime, visibility }) => ({
      id,
      name,
      date,
      startTime,
      endTime,
      visibility,
    })),
  };
}

export default function EventOverview({ loaderData, actionData }: Route.ComponentProps) {
  const { event, sheets } = loaderData;
  const navigation = useNavigation();
  const values: SheetFormValues = actionData?.values ?? {
    name: DEFAULT_NAME,
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    stepMin: String(event.stepMin),
    maxConsecutive: String(event.maxConsecutive),
    noSoloNewcomer: event.noSoloNewcomer,
  };
  const errors = actionData?.errors ?? {};
  const submitting = navigation.state === "submitting";
  const pendingSheetId = navigation.formData?.get("sheetId");
  const pendingIntent = navigation.formData?.get("intent");
  const reorderPending = pendingIntent === "reorderSheets";
  const sheetIds = sheets.map(({ id }) => id);

  return (
    <main className="admin-page">
      <PageHeader
        title={event.name}
        description="開催するシフト表を選択してください。"
        actions={
          <>
            <Link asChild>
              <RouterLink to={`/e/${event.id}/staff`}>スタッフ</RouterLink>
            </Link>
            <Link asChild>
              <RouterLink to={`/e/${event.id}/share`}>共有</RouterLink>
            </Link>
          </>
        }
      />

      <Card>
        <Stack>
          <Heading level={2}>シフト表を追加</Heading>
          <p className="gdg-muted text-sm">このイベント内で使うシフト表を作成します。</p>
          {actionData?.formError && (
            <p className="text-sm text-destructive" role="alert">
              {actionData.formError}
            </p>
          )}
          <Form method="post" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <input type="hidden" name="intent" value="createSheet" />
            <FormField id="sheet-name" label="シフト表名" error={errors.name} required>
              <Input
                name="name"
                type="text"
                defaultValue={values.name}
                maxLength={100}
                required
                autoComplete="off"
              />
            </FormField>
            <FormField id="sheet-date" label="開催日" error={errors.date} required>
              <Input name="date" type="date" defaultValue={values.date} required />
            </FormField>
            <FormField id="sheet-start" label="開始時刻" error={errors.startTime} required>
              <Input name="startTime" type="time" defaultValue={values.startTime} required />
            </FormField>
            <FormField id="sheet-end" label="終了時刻" error={errors.endTime} required>
              <Input name="endTime" type="time" defaultValue={values.endTime} required />
            </FormField>
            <FormField id="sheet-step" label="時間枠の刻み幅" error={errors.stepMin} required>
              <NativeSelect name="stepMin" defaultValue={values.stepMin} required>
                <NativeSelectOption value="">選択してください</NativeSelectOption>
                {values.stepMin &&
                  !SUPPORTED_STEPS.some((step) => String(step) === values.stepMin) && (
                    <NativeSelectOption value={values.stepMin}>
                      {values.stepMin}分（選択できません）
                    </NativeSelectOption>
                  )}
                {SUPPORTED_STEPS.map((step) => (
                  <NativeSelectOption key={step} value={step}>
                    {step}分
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              id="sheet-max-consecutive"
              label="連続担当の上限"
              error={errors.maxConsecutive}
              required
            >
              <Input
                name="maxConsecutive"
                type="number"
                min={1}
                step={1}
                defaultValue={values.maxConsecutive}
                required
              />
            </FormField>
            <FormField id="sheet-no-solo" label="新人を単独の時間枠に割り当てない">
              <Checkbox name="noSoloNewcomer" value="true" defaultChecked={values.noSoloNewcomer} />
            </FormField>
            <div className="sm:col-span-2">
              <Button type="submit" loading={submitting}>
                シフト表を作成
              </Button>
            </div>
          </Form>
        </Stack>
      </Card>

      {actionData?.reorderError && (
        <p className="text-sm text-destructive" role="alert">
          {actionData.reorderError}
        </p>
      )}
      {sheets.length === 0 ? (
        <output className="gdg-muted">シフト表はまだありません。</output>
      ) : (
        <ul className="grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2 xl:grid-cols-3">
          {sheets.map((sheet) => {
            const isDefault = sheet.id === `default:${event.id}`;
            const sheetError =
              actionData?.sheetError?.sheetId === sheet.id
                ? actionData.sheetError.message
                : undefined;
            return (
              <li key={sheet.id}>
                <RosterSheetCard
                  sheet={sheet}
                  eventId={event.id}
                  visibility={sheet.visibility}
                  isDefault={isDefault}
                  error={sheetError}
                  visibilityPending={
                    pendingSheetId === sheet.id && pendingIntent === "setVisibility"
                  }
                  archivePending={pendingSheetId === sheet.id && pendingIntent === "archiveSheet"}
                  reorderSheetIds={sheetIds}
                  reorderPending={reorderPending}
                />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
