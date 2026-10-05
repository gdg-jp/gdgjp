import { Badge, Card, Heading, Link, PageHeader, Stack } from "@gdgjp/design-system";
import { Form, Link as RouterLink, redirect, useNavigation } from "react-router";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { canManageEvent } from "~/features/auth/permissions";
import { getEvent } from "~/features/events/events.server";
import { NewRosterSheetDialog } from "~/features/roster-sheets/components/NewRosterSheetDialog";
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
  const publishedCount = sheets.filter((sheet) => sheet.visibility === "published").length;

  return (
    <main className="admin-page event-overview">
      <span className="brand-eyebrow">EVENT / SHIFT BOARDS</span>
      <PageHeader
        title={event.name}
        description={`${event.date} · ${sheets.length}件のシフト表 · ${publishedCount}件公開中`}
        actions={
          <NewRosterSheetDialog
            values={values}
            errors={errors}
            formError={actionData?.formError}
            submitting={submitting && pendingIntent === "createSheet"}
            sheetCount={sheets.length}
          />
        }
      />
      <section aria-labelledby="sheet-list-heading" className="space-y-4 sheet-list-section">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Heading id="sheet-list-heading" level={2}>
              シフト表
            </Heading>
            <p className="gdg-muted text-sm">シフト表を選んで割当や設計を編集します。</p>
          </div>
          <Link asChild>
            <RouterLink to={`/e/${event.id}/staff`}>スタッフを管理</RouterLink>
          </Link>
        </div>

        {actionData?.reorderError && (
          <p className="text-sm text-destructive" role="alert">
            {actionData.reorderError}
          </p>
        )}
        {sheets.length === 0 ? (
          <Card>
            <Stack>
              <p>シフト表はまだありません。</p>
              <p className="gdg-muted text-sm">
                「シフト表を追加」から最初のシフト表を作成してください。
              </p>
            </Stack>
          </Card>
        ) : (
          <ul className="sheet-card-grid">
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
      </section>
      <div className="flex flex-wrap items-center gap-3 text-sm gdg-muted">
        <Badge tone={publishedCount > 0 ? "success" : "neutral"}>{publishedCount}件公開中</Badge>
        <span>公開URLは共有画面で確認できます。</span>
        <Link asChild>
          <RouterLink to={`/e/${event.id}/share`}>共有画面へ</RouterLink>
        </Link>
      </div>
    </main>
  );
}
