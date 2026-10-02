import { Link as UiLink } from "@gdgjp/ui";
import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { canManageEvent } from "~/features/auth/permissions";
import { DemandMatrix } from "~/features/demand/components/DemandMatrix";
import { bulkUpsertDemands, listDemandsForEvent } from "~/features/demand/demand.server";
import { type MatrixMode, timeSlotIdsForTarget } from "~/features/demand/matrix";
import type { DemandValue } from "~/features/demand/types";
import { firstDemandValidationMessage, validateDemand } from "~/features/demand/validate";
import { getEvent } from "~/features/events/events.server";
import { SheetSettingsForm } from "~/features/roster-sheets/components/SheetSettingsForm";
import { getRosterSheet, updateRosterSheet } from "~/features/roster-sheets/roster-sheets.server";
import type { RosterSheet } from "~/features/roster-sheets/types";
import { PhaseList } from "~/features/schedule/components/PhaseList";
import { RolePicker } from "~/features/schedule/components/RolePicker";
import { TrackEditor } from "~/features/schedule/components/TrackEditor";
import {
  createPhase,
  deletePhase,
  listPhases,
  listTimeSlots,
  regenerateTimeSlots,
} from "~/features/schedule/schedule.server";
import { isValidTime, toMin } from "~/features/schedule/slots";
import {
  createTrack,
  deleteTrack,
  listEventRoleIds,
  listRoles,
  listTracks,
  reorderTracks,
  setEventRoles,
} from "~/features/schedule/tracks.server";
import { getDb } from "~/lib/db.server";
import type { Route } from "./+types/e.$id.s.$sheetId.design";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.sheet.name} — 設計 — roster` : "roster" }];
}

/**
 * `/e/:id/s/:sheetId/design`: selected-sheet settings, phases + derived
 * time-slot grid, tracks, roles, and demand. Access stays chapter-gated.
 */
async function requireDesignAccess(env: Env, request: Request, id: string | undefined) {
  const { chapters } = await requireUserWithChapter(env, request);
  if (!id) throw new Response(null, { status: 404 });
  const event = await getEvent(getDb(env), id);
  if (!event) throw new Response(null, { status: 404 });
  if (!canManageEvent(chapters, event)) throw new Response("Forbidden", { status: 403 });
  return event;
}

async function requireSelectedSheet(db: D1Database, eventId: string, sheetId: string | undefined) {
  if (!sheetId) throw new Response(null, { status: 404 });
  const sheet = await getRosterSheet(db, eventId, sheetId);
  if (!sheet) throw new Response(null, { status: 404 });
  return sheet;
}

async function loadSheetDesign(
  env: Env,
  request: Request,
  id: string | undefined,
  sheetId: string | undefined,
) {
  const event = await requireDesignAccess(env, request, id);
  const db = getDb(env);
  const sheet = await requireSelectedSheet(db, event.id, sheetId);
  const [phases, timeSlots, tracks, roles, eventRoleIds, demands] = await Promise.all([
    listPhases(db, event.id, sheet.id),
    listTimeSlots(db, event.id, sheet.id),
    listTracks(db, event.id, sheet.id),
    listRoles(db),
    listEventRoleIds(db, event.id, sheet.id),
    listDemandsForEvent(db, event.id, sheet.id),
  ]);
  return { event, sheet, phases, timeSlots, tracks, roles, eventRoleIds, demands };
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  return loadSheetDesign(context.cloudflare.env, request, params.id, params.sheetId);
}

/** `min`/`ideal`/`leadMin`/`newMax` from a demand form submission, or `null` if any is missing/non-numeric/negative. */
function parseDemandValueFromForm(form: FormData): DemandValue | null {
  const min = Number.parseInt(String(form.get("min") ?? ""), 10);
  const ideal = Number.parseInt(String(form.get("ideal") ?? ""), 10);
  const leadMin = Number.parseInt(String(form.get("leadMin") ?? ""), 10);
  const newMax = Number.parseInt(String(form.get("newMax") ?? ""), 10);
  if ([min, ideal, leadMin, newMax].some((n) => Number.isNaN(n) || n < 0)) return null;
  return { min, ideal, leadMin, newMax };
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}

async function regenerateAfterScheduleChange(
  db: D1Database,
  eventId: string,
  sheet: Pick<RosterSheet, "id" | "startTime" | "endTime" | "stepMin">,
) {
  const phases = await listPhases(db, eventId, sheet.id);
  await regenerateTimeSlots(
    db,
    eventId,
    { start: sheet.startTime, end: sheet.endTime, stepMin: sheet.stepMin },
    phases,
    sheet.id,
  );
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const event = await requireDesignAccess(env, request, params.id);
  const db = getDb(env);
  const sheet = await requireSelectedSheet(db, event.id, params.sheetId);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  switch (intent) {
    case "updateSettings": {
      const name = String(form.get("name") ?? "").trim();
      const date = String(form.get("date") ?? "");
      const startTime = String(form.get("startTime") ?? "");
      const endTime = String(form.get("endTime") ?? "");
      const stepMin = Number.parseInt(String(form.get("stepMin") ?? ""), 10);
      const maxConsecutive = Number.parseInt(String(form.get("maxConsecutive") ?? ""), 10);
      if (!name || name.length > 100)
        return { error: "シフト表名は1〜100文字で入力してください。" };
      if (!isValidDate(date)) return { error: "開催日が不正です。" };
      if (!isValidTime(startTime) || !isValidTime(endTime) || startTime >= endTime) {
        return { error: "開始時刻と終了時刻が不正です。" };
      }
      if (![15, 30, 60].includes(stepMin)) return { error: "刻み幅が不正です。" };
      if (
        !/^\d+$/.test(String(form.get("maxConsecutive") ?? "")) ||
        !Number.isSafeInteger(maxConsecutive) ||
        maxConsecutive < 1
      )
        return { error: "連続担当の上限が不正です。" };
      if (toMin(endTime) - toMin(startTime) < stepMin) {
        return { error: "時間の長さは刻み幅以上にしてください。" };
      }
      const updated = await updateRosterSheet(db, event.id, sheet.id, {
        name,
        date,
        startTime,
        endTime,
        stepMin,
        maxConsecutive,
        noSoloNewcomer: form.get("noSoloNewcomer") === "true",
      });
      if (
        updated.startTime !== sheet.startTime ||
        updated.endTime !== sheet.endTime ||
        updated.stepMin !== sheet.stepMin
      ) {
        await regenerateAfterScheduleChange(db, event.id, updated);
      }
      return { ok: true };
    }
    case "createPhase": {
      const name = String(form.get("name") ?? "").trim();
      const from = String(form.get("from") ?? "");
      const to = String(form.get("to") ?? "");
      if (!name || !isValidTime(from) || !isValidTime(to) || from >= to) {
        return { error: "フェーズの入力が不正です。" };
      }
      await createPhase(db, event.id, { name, from, to }, sheet.id);
      await regenerateAfterScheduleChange(db, event.id, sheet);
      return { ok: true };
    }
    case "deletePhase": {
      await deletePhase(db, String(form.get("phaseId") ?? ""), event.id, sheet.id);
      await regenerateAfterScheduleChange(db, event.id, sheet);
      return { ok: true };
    }
    case "createTrack": {
      const name = String(form.get("name") ?? "").trim();
      if (!name) return { error: "トラック名を入力してください。" };
      await createTrack(
        db,
        event.id,
        {
          name,
          color: String(form.get("color") ?? "#4285f4"),
          shared: form.get("shared") === "1",
        },
        sheet.id,
      );
      return { ok: true };
    }
    case "deleteTrack": {
      await deleteTrack(db, String(form.get("trackId") ?? ""), event.id, sheet.id);
      return { ok: true };
    }
    case "moveTrack": {
      const trackId = String(form.get("trackId") ?? "");
      const direction = String(form.get("direction") ?? "");
      const tracks = await listTracks(db, event.id, sheet.id);
      const index = tracks.findIndex((t) => t.id === trackId);
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (index >= 0 && swapWith >= 0 && swapWith < tracks.length) {
        const ids = tracks.map((t) => t.id);
        [ids[index], ids[swapWith]] = [ids[swapWith], ids[index]];
        await reorderTracks(db, event.id, ids, sheet.id);
      }
      return { ok: true };
    }
    case "setRoles": {
      const submitted = new Set(form.getAll("roleId").map(String));
      const knownIds = new Set((await listRoles(db)).map((r) => r.id));
      const roleIds = [...submitted].filter((id) => knownIds.has(id));
      await setEventRoles(db, event.id, roleIds, sheet.id);
      return { ok: true };
    }
    // `saveDemand` / `copyDemand` back `~/features/demand/components/DemandDrawer`
    // (docs/roster/03-demand-input.md "Design" §4). Both share the same
    // value fields; `copyDemand` additionally fans the value out to the
    // checked `copyTrackId` (same row, other track) and `copyRowKey` (other
    // phase, same track) targets — see the drawer's module doc for why
    // those two axes are independent rather than a full cross-product.
    case "saveDemand":
    case "copyDemand": {
      const mode = String(form.get("mode") ?? "") as MatrixMode;
      const rowKey = String(form.get("rowKey") ?? "");
      const trackId = String(form.get("trackId") ?? "");
      const roleId = String(form.get("roleId") ?? "");
      if (!rowKey || !trackId || !roleId) return { error: "需要の対象が不正です。" };

      // Scope trackId (and, for a copy, every copyTrackId) to this event's
      // own tracks — `demands.track_id` only has a bare FK to `tracks(id)`,
      // not one scoped by event_id, so an unchecked id could otherwise
      // write a row whose denormalized event_id disagrees with its
      // track_id's real event. roleId only needs to be a real role (like
      // `setRoles` below) since the roles master itself isn't per-event.
      const [eventTracks, knownRoleIds] = await Promise.all([
        listTracks(db, event.id, sheet.id),
        listRoles(db).then((rs) => new Set(rs.map((r) => r.id))),
      ]);
      const eventTrackIds = new Set(eventTracks.map((t) => t.id));
      if (!eventTrackIds.has(trackId) || !knownRoleIds.has(roleId)) {
        return { error: "需要の対象が不正です。" };
      }

      const value = parseDemandValueFromForm(form);
      if (!value) return { error: "需要の入力が不正です。" };
      const validationErrors = validateDemand(value);
      if (validationErrors.length > 0) {
        return { error: firstDemandValidationMessage(value) ?? "需要の入力が不正です。" };
      }

      const timeSlots = await listTimeSlots(db, event.id, sheet.id);
      const copyTrackIds = form
        .getAll("copyTrackId")
        .map(String)
        .filter((id) => eventTrackIds.has(id));
      const targets: { rowKey: string; trackId: string }[] =
        intent === "copyDemand"
          ? [
              { rowKey, trackId },
              ...copyTrackIds.map((id) => ({ rowKey, trackId: id })),
              ...form.getAll("copyRowKey").map((key) => ({ rowKey: String(key), trackId })),
            ]
          : [{ rowKey, trackId }];

      const entries = targets.flatMap((target) =>
        timeSlotIdsForTarget(mode, target.rowKey, timeSlots).map((timeSlotId) => ({
          timeSlotId,
          trackId: target.trackId,
          roleId,
          ...value,
        })),
      );
      await bulkUpsertDemands(db, event.id, entries, sheet.id);
      return { ok: true };
    }
    default:
      return { error: "不明な操作です。" };
  }
}

export default function EventDesign({ loaderData, actionData }: Route.ComponentProps) {
  const { event, sheet, phases, timeSlots, tracks, roles, eventRoleIds, demands } = loaderData;
  // The "役割を追加" affordance only offers roles the event has actually
  // selected (docs/roster/03-demand-input.md "Design" §3) — DemandMatrix
  // expects that filtering to already be done by its caller.
  const selectedRoles = roles.filter((r) => eventRoleIds.includes(r.id));
  return (
    <main className="admin-page">
      <div className="page-heading">
        <div>
          <h1>設計</h1>
          <p>
            {event.name} · {sheet.name} · {sheet.date} {sheet.startTime}–{sheet.endTime}
          </p>
        </div>
        <nav className="flex flex-wrap gap-3">
          <UiLink asChild>
            <RouterLink to={`/e/${event.id}`}>シフト表一覧</RouterLink>
          </UiLink>
          <UiLink asChild>
            <RouterLink to={`/e/${event.id}/staff`}>スタッフ</RouterLink>
          </UiLink>
        </nav>
      </div>

      {actionData && "error" in actionData ? (
        <p role="alert" className="text-sm font-medium text-gdg-red">
          {actionData.error}
        </p>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Section title="シフト表設定">
          <SheetSettingsForm
            sheet={sheet}
            phases={phases}
            timeSlots={timeSlots}
            demands={demands}
          />
        </Section>
        <Section title="フェーズと時間枠">
          <PhaseList phases={phases} timeSlots={timeSlots} sheetId={sheet.id} />
        </Section>
        <Section title="トラック">
          <TrackEditor tracks={tracks} sheetId={sheet.id} />
        </Section>
        <Section title="使う役割">
          <RolePicker roles={roles} selectedRoleIds={eventRoleIds} sheetId={sheet.id} />
        </Section>
      </div>
      <Section title="需要">
        <DemandMatrix
          phases={phases}
          timeSlots={timeSlots}
          tracks={tracks}
          roles={selectedRoles}
          demands={demands}
          sheetId={sheet.id}
        />
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}
