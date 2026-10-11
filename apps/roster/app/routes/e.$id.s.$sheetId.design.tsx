import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { canManageEvent } from "~/features/auth/permissions";
import { bulkUpsertDemands, listDemandsForEvent } from "~/features/demand/demand.server";
import { type SlotRowCounts, slotDataLossOnSlotChange } from "~/features/demand/impact";
import { type MatrixMode, timeSlotIdsForTarget } from "~/features/demand/matrix";
import {
  isSlotDataSnapshotConflict,
  listSlotDataCounts,
  listSlotDependentRowIds,
  prepareSettingsAndSlotDataGuard,
} from "~/features/demand/slot-impact-guard.server";
import type { DemandValue } from "~/features/demand/types";
import { firstDemandValidationMessage, validateDemand } from "~/features/demand/validate";
import { getEvent } from "~/features/events/events.server";
import DesignScreen from "~/features/roster-sheets/DesignScreen";
import { getRosterSheet, updateRosterSheet } from "~/features/roster-sheets/roster-sheets.server";
import type { RosterSheet } from "~/features/roster-sheets/types";
import { handleRoleIntent } from "~/features/schedule/role-intents.server";
import { listEventRoleIds, listRoles } from "~/features/schedule/roles.server";
import {
  createPhase,
  deletePhase,
  listPhases,
  listTimeSlots,
  regenerateTimeSlots,
} from "~/features/schedule/schedule.server";
import { buildSlots, isValidTime, toMin } from "~/features/schedule/slots";
import {
  createTrack,
  deleteTrack,
  listTracks,
  reorderTracks,
} from "~/features/schedule/tracks.server";
import { getDb } from "~/lib/db.server";
import type { Route } from "./+types/e.$id.s.$sheetId.design";

// React Router only injects loaderData/actionData into a default export defined in the route
// module itself; a re-exported component would render with undefined props.
export default function SheetDesignRoute({ loaderData, actionData }: Route.ComponentProps) {
  return <DesignScreen loaderData={loaderData} actionData={actionData} />;
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.sheet.name} — 設計 — roster` : "roster" }];
}

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
  const [phases, timeSlots, tracks, roles, eventRoleIds, demands, slotDataCounts] =
    await Promise.all([
      listPhases(db, event.id, sheet.id),
      listTimeSlots(db, event.id, sheet.id),
      listTracks(db, event.id, sheet.id),
      listRoles(db, event.id),
      listEventRoleIds(db, event.id, sheet.id),
      listDemandsForEvent(db, event.id, sheet.id),
      listSlotDataCounts(db, event.id, sheet.id),
    ]);
  return {
    event,
    sheet,
    phases,
    timeSlots,
    tracks,
    roles,
    eventRoleIds,
    demands,
    ...slotDataCounts,
  };
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

export async function loader({ request, context, params }: Route.LoaderArgs) {
  return loadSheetDesign(context.cloudflare.env, request, params.id, params.sheetId);
}

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
      const scheduleChanged =
        startTime !== sheet.startTime || endTime !== sheet.endTime || stepMin !== sheet.stepMin;
      if (scheduleChanged) {
        const [phases, timeSlots, demands, slotDataCounts, slotDataRowIds] = await Promise.all([
          listPhases(db, event.id, sheet.id),
          listTimeSlots(db, event.id, sheet.id),
          listDemandsForEvent(db, event.id, sheet.id),
          listSlotDataCounts(db, event.id, sheet.id),
          listSlotDependentRowIds(db, event.id, sheet.id),
        ]);
        const impact = slotDataLossOnSlotChange(
          timeSlots,
          buildSlots({ start: startTime, end: endTime, stepMin }, phases),
          demands,
          slotDataCounts.availabilityCounts,
          slotDataCounts.assignmentCounts,
        );
        if (
          impact.hasLoss &&
          String(form.get("slotDataLossConfirmation") ?? "") !== impact.confirmationKey
        ) {
          return {
            error:
              "時間枠の変更で需要・スタッフの希望・割当が失われます。内容を確認してからもう一度保存してください。",
          };
        }
        try {
          await regenerateTimeSlots(
            db,
            event.id,
            { start: startTime, end: endTime, stepMin },
            phases,
            sheet.id,
            prepareSettingsAndSlotDataGuard(
              db,
              event.id,
              sheet,
              {
                name,
                date,
                startTime,
                endTime,
                stepMin,
                maxConsecutive,
                noSoloNewcomer: form.get("noSoloNewcomer") === "true",
              },
              timeSlots,
              impact,
              slotDataRowIds,
            ),
          );
        } catch (error) {
          if (isSlotDataSnapshotConflict(error)) {
            return {
              error:
                "保存データが確認後に変更されました。最新の内容を読み込み、もう一度確認してください。",
            };
          }
          throw error;
        }
      } else {
        await updateRosterSheet(db, event.id, sheet.id, {
          name,
          date,
          startTime,
          endTime,
          stepMin,
          maxConsecutive,
          noSoloNewcomer: form.get("noSoloNewcomer") === "true",
        });
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
    case "setRoles":
    case "createRole":
    case "renameRole":
    case "deleteRole":
      return handleRoleIntent(db, event.id, sheet.id, intent, form);
    // `saveDemand` / `copyDemand` back `~/features/demand/components/DemandDrawer`
    // (docs/roster/03-demand-input.md "Design" §4). Both share the same
    // value fields; `copyDemand` additionally fans the value out to the
    // checked `copyTrackId` (same row, other track) and `copyRowKey` (other
    // phase, same track) targets — see the drawer's module doc for details.
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
      // track_id's real event. roleId must be a seeded role or one of this
      // event's own (`listRoles` is event-scoped, ADR-011) — another event's
      // custom role id is rejected here like a foreign track id.
      const [eventTracks, knownRoleIds] = await Promise.all([
        listTracks(db, event.id, sheet.id),
        listRoles(db, event.id).then((rs) => new Set(rs.map((r) => r.id))),
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
