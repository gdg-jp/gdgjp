import { useMemo } from "react";
import { listApplicationsForEvent } from "~/features/applications/applications.server";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { canManageEvent } from "~/features/auth/permissions";
import { getEvent } from "~/features/events/events.server";
import { HistoryPanel } from "~/features/history/components/HistoryPanel";
import { UndoRedoButtons } from "~/features/history/components/UndoRedoButtons";
import { canRedo, canUndo } from "~/features/history/cursor";
import {
  getHistoryState,
  redoRevision,
  tryRestoreRevision,
  undoRevision,
} from "~/features/history/history.server";
import type { Actor } from "~/features/history/types";
import { SheetHeader } from "~/features/roster-sheets/components/SheetHeader";
import { getRosterSheet, updateRosterSheet } from "~/features/roster-sheets/roster-sheets.server";
import { CellDrawer } from "~/features/roster/components/CellDrawer";
import { DemandCellDrawer } from "~/features/roster/components/DemandCellDrawer";
import { GeneratePanel, type GenerateResult } from "~/features/roster/components/GeneratePanel";
import { MetricsRow } from "~/features/roster/components/MetricsRow";
import { RosterGridViews } from "~/features/roster/components/RosterGridViews";
import { ShortageReport } from "~/features/roster/components/ShortageReport";
import { buildStaffColumns } from "~/features/roster/grid";
import { assignManually } from "~/features/roster/manual-assignment.server";
import {
  readAssignmentsMap,
  readAssignmentsState,
  writeGeneratedAssignments,
  writeManualEdit,
} from "~/features/roster/roster.server";
import { buildSolverInput } from "~/features/roster/solver-input.server";
import { useRosterDrawers } from "~/features/roster/use-roster-drawers";
import { listTimeSlots } from "~/features/schedule/schedule.server";
import { listEventRoleIds, listRoles, listTracks } from "~/features/schedule/tracks.server";
import { evaluate } from "~/features/solver/evaluate";
import { solve } from "~/features/solver/solve";
import { type Assignments, type SolverInput, assignmentKey } from "~/features/solver/types";
import { getDb } from "~/lib/db.server";
import type { Route } from "./+types/e.$id.s.$sheetId.roster";

/**
 * `/e/:id/s/:sheetId/roster` (docs/roster/07-roster-manual-edit.md, docs/roster/
 * 08-history.md): the shift table. "自動生成" runs the Stage 06 solver inside
 * this action (ADR-004) and writes through `roster.server.ts#writeAssignments`
 * — the ONLY write path. `assign`/`unassign` funnel through the same
 * function via `roster.server.ts#writeManualEdit`, now with a `revision`
 * argument so Stage 08's history records every generate/edit automatically
 * (see `roster.server.ts`'s module doc). `undo`/`redo`/`restore` (Stage 08)
 * move `events.revision_cursor` instead — never passing a `revision`
 * argument, which is what keeps them from creating new history entries.
 *
 * `evaluate()`/`hardViolations()`/`suggestFor()` are called here (via
 * `grid.ts`) and, for the live drawers, directly in the browser (ADR-004),
 * so shipping the assembled `SolverInput` down as loader data keeps the
 * drawers' numbers byte-identical to `evaluate()`'s, with no extra round trip.
 */

async function requireRosterAccess(
  env: Env,
  request: Request,
  id: string | undefined,
  sheetId: string | undefined,
) {
  const { user, chapters } = await requireUserWithChapter(env, request);
  if (!id) throw new Response(null, { status: 404 });
  const event = await getEvent(getDb(env), id);
  if (!event) throw new Response(null, { status: 404 });
  if (!canManageEvent(chapters, event)) throw new Response("Forbidden", { status: 403 });
  if (!sheetId) throw new Response(null, { status: 404 });
  const sheet = await getRosterSheet(getDb(env), event.id, sheetId);
  if (!sheet) throw new Response(null, { status: 404 });
  const actor: Actor = { id: user.id, name: user.name };
  return { event, sheet, actor };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.event.name} — シフト表 — roster` : "roster" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { event, sheet } = await requireRosterAccess(env, request, params.id, params.sheetId);
  const db = getDb(env);

  const [timeSlots, tracks, eventRoleIds, allRoles, applications, input, assignments, history] =
    await Promise.all([
      listTimeSlots(db, event.id, sheet.id),
      listTracks(db, event.id, sheet.id),
      listEventRoleIds(db, event.id, sheet.id),
      listRoles(db),
      listApplicationsForEvent(db, event.id),
      buildSolverInput(db, event, sheet.seed, sheet.id),
      readAssignmentsMap(db, event.id, sheet.id),
      getHistoryState(db, event.id, sheet.id),
    ]);

  const roleIdSet = new Set(eventRoleIds);
  const roles = allRoles.filter((r) => roleIdSet.has(r.id));
  const report = evaluate(input, assignments);
  const roleNameById = new Map(roles.map((r) => [r.id, r.name]));
  const staffColumns = buildStaffColumns(applications, input, roleNameById, assignments);

  return {
    event: { id: event.id, name: event.name, status: event.status },
    sheet: {
      id: sheet.id,
      name: sheet.name,
      date: sheet.date,
      startTime: sheet.startTime,
      endTime: sheet.endTime,
      seed: sheet.seed,
    },
    timeSlots: timeSlots.map((s) => ({ id: s.id, idx: s.idx, start: s.start, end: s.end })),
    tracks: tracks.map((t) => ({ id: t.id, name: t.name, color: t.color, sortOrder: t.sortOrder })),
    roles: roles.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sortOrder })),
    staffColumns,
    applicationNameById: Object.fromEntries(applications.map((a) => [a.id, a.name])),
    inputWire: {
      slots: input.slots,
      tracks: input.tracks,
      roles: input.roles,
      applications: input.applications,
      options: input.options,
      demandEntries: [...input.demands],
    },
    assignmentEntries: [...assignments],
    report,
    hasAssignments: assignments.size > 0,
    history,
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { event, sheet, actor } = await requireRosterAccess(
    env,
    request,
    params.id,
    params.sheetId,
  );
  const db = getDb(env);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "generate") {
    const rawSeed = Number(form.get("seed"));
    const seed = Number.isFinite(rawSeed) ? Math.trunc(rawSeed) : sheet.seed;
    const assignmentState = await readAssignmentsState(db, event.id, sheet.id);
    const input = await buildSolverInput(db, event, seed, sheet.id);
    const start = Date.now();
    const { assignments, report } = solve(input);
    const ms = Date.now() - start;
    const saved = await writeGeneratedAssignments(
      db,
      event.id,
      assignments,
      {
        metrics: report.metrics,
        label: `自動生成（シード ${seed}）`,
        actor,
        kind: "generate",
      },
      sheet.id,
      assignmentState.revisionCursor,
    );
    if (!saved) {
      return {
        ok: false as const,
        intent: "generate" as const,
        error:
          "別のシフト表で重複する割り当てが追加されました。画面を再読み込みして、もう一度自動生成してください。",
      };
    }
    if (seed !== sheet.seed) await updateRosterSheet(db, event.id, sheet.id, { seed });
    return { ok: true as const, intent: "generate" as const, ms, seed };
  }

  if (intent === "assign") {
    return assignManually(
      db,
      event,
      actor,
      {
        applicationId: String(form.get("applicationId") ?? ""),
        trackId: String(form.get("trackId") ?? ""),
        roleId: String(form.get("roleId") ?? ""),
        slotIds: form.getAll("slotId").map(String),
      },
      String(form.get("conflictConfirmation") ?? ""),
      env.RP_SESSION_SECRET,
      sheet.id,
    );
  }

  if (intent === "unassign") {
    const applicationId = String(form.get("applicationId") ?? "");
    const slotIds = form.getAll("slotId").map(String);
    if (!applicationId || slotIds.length === 0) {
      return { error: "入力が不正です。", intent: "unassign" as const };
    }
    const assignmentState = await readAssignmentsState(db, event.id, sheet.id);
    const current = assignmentState.assignments;
    for (const slotId of slotIds) current.delete(assignmentKey(applicationId, slotId));
    await writeManualEdit(db, event, actor, current, sheet.id, assignmentState.revisionCursor);
    return { ok: true as const, intent: "unassign" as const };
  }

  if (intent === "undo") {
    const result = await undoRevision(db, event.id, actor, sheet.id);
    return { ok: true as const, intent: "undo" as const, droppedCount: result?.droppedCount ?? 0 };
  }

  if (intent === "redo") {
    const result = await redoRevision(db, event.id, actor, sheet.id);
    return { ok: true as const, intent: "redo" as const, droppedCount: result?.droppedCount ?? 0 };
  }

  if (intent === "restore") {
    const seq = Number(form.get("seq"));
    if (!Number.isFinite(seq)) {
      return { error: "復元先が不正です。", intent: "restore" as const };
    }
    const outcome = await tryRestoreRevision(db, event.id, Math.trunc(seq), actor, sheet.id);
    if (!outcome.found) {
      return { error: "復元先の履歴が見つかりませんでした。", intent: "restore" as const };
    }
    return { ok: true as const, intent: "restore" as const, droppedCount: outcome.droppedCount };
  }

  return { error: "不明な操作です。", intent: "unknown" as const };
}

export default function RosterPage({ loaderData, actionData }: Route.ComponentProps) {
  const {
    event,
    sheet,
    timeSlots,
    tracks,
    roles,
    staffColumns,
    applicationNameById,
    report,
    hasAssignments,
    history,
  } = loaderData;

  const input: SolverInput = useMemo(
    () => ({
      slots: loaderData.inputWire.slots,
      tracks: loaderData.inputWire.tracks,
      roles: loaderData.inputWire.roles,
      applications: loaderData.inputWire.applications,
      options: loaderData.inputWire.options,
      demands: new Map(loaderData.inputWire.demandEntries),
    }),
    [loaderData.inputWire],
  );
  const assignments: Assignments = useMemo(
    () => new Map(loaderData.assignmentEntries),
    [loaderData.assignmentEntries],
  );

  const trackNameById = useMemo(() => new Map(tracks.map((t) => [t.id, t.name])), [tracks]);
  const roleNameById = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles]);
  const slotLabelById = useMemo(
    () => new Map(timeSlots.map((s) => [s.id, `${s.start}–${s.end}`])),
    [timeSlots],
  );
  const trackInfoById = useMemo(
    () => new Map(tracks.map((t) => [t.id, { name: t.name, color: t.color }])),
    [tracks],
  );
  const applicationNameByIdMap = useMemo(
    () => new Map(Object.entries(applicationNameById)),
    [applicationNameById],
  );

  const actionIntent = actionData && "intent" in actionData ? actionData.intent : undefined;
  const actionError = actionData && "error" in actionData ? actionData.error : undefined;
  const actionSucceeded =
    actionData && "ok" in actionData && actionData.ok ? actionData : undefined;
  const crossSheetWarning =
    actionData && "warning" in actionData && actionData.warning === "cross-sheet"
      ? actionData
      : undefined;

  const cellSucceeded =
    actionIntent === "assign" || actionIntent === "unassign" ? actionSucceeded : undefined;
  const cellError =
    actionIntent === "assign" || actionIntent === "unassign" ? actionError : undefined;

  // docs/roster/08-history.md "Design" §5: a restore/undo/redo that dropped
  // stale snapshot entries (a withdrawn applicant, a regenerated schedule)
  // must say so, not silently return fewer assignments than expected.
  // Narrows on `actionData.intent` (a literal discriminant unique to each
  // `ok: true` variant) rather than a structural `"droppedCount" in ...`
  // check, which TS can't fully narrow across a 6-member union.
  const droppedCount =
    actionData &&
    "ok" in actionData &&
    actionData.ok &&
    (actionData.intent === "undo" ||
      actionData.intent === "redo" ||
      actionData.intent === "restore")
      ? actionData.droppedCount
      : 0;

  const drawers = useRosterDrawers({
    input,
    assignments,
    applicationNameById,
    slotLabelById,
    trackNameById,
    roleNameById,
    closeOnSuccess: cellSucceeded,
  });

  let generateResult: GenerateResult | undefined;
  if (actionData?.intent === "generate" && "ok" in actionData && actionData.ok) {
    generateResult = { ok: true, ms: actionData.ms, seed: actionData.seed };
  } else if (actionData?.intent === "generate" && "error" in actionData) {
    generateResult = { ok: false, error: actionData.error };
  }

  return (
    <main className="admin-page admin-page-wide">
      <SheetHeader eventId={event.id} eventName={event.name} sheet={sheet} active="roster" />

      <GeneratePanel
        seed={sheet.seed}
        hasAssignments={hasAssignments}
        lastResult={generateResult}
      />

      {droppedCount > 0 ? (
        <p
          role="alert"
          className="rounded-xl border-2 border-border bg-card p-3 text-sm font-medium"
        >
          {droppedCount}件の割当は対象が存在しないため復元されませんでした。
        </p>
      ) : null}

      {hasAssignments ? (
        <>
          <MetricsRow metrics={report.metrics} />
          <ShortageReport
            report={report}
            slotLabelById={slotLabelById}
            trackNameById={trackNameById}
            roleNameById={roleNameById}
          />

          <RosterGridViews
            timeSlots={timeSlots}
            tracks={tracks}
            roles={roles}
            staffColumns={staffColumns}
            assignments={assignments}
            demands={input.demands}
            report={report}
            trackInfoById={trackInfoById}
            roleNameById={roleNameById}
            applicationNameById={applicationNameById}
            onStaffCellClick={drawers.openStaffCell}
            onDemandCellSelect={drawers.openDemandCell}
            toolbarRight={<UndoRedoButtons canUndo={canUndo(history)} canRedo={canRedo(history)} />}
          />
        </>
      ) : null}

      <HistoryPanel cursor={history.cursor} revisions={history.revisions} />

      <CellDrawer
        selection={drawers.staffSelection}
        current={drawers.staffCurrent}
        candidates={drawers.staffCandidates}
        trackNameById={trackNameById}
        roleNameById={roleNameById}
        error={cellError}
        crossSheetWarning={crossSheetWarning}
        succeeded={cellSucceeded}
        onClose={drawers.closeStaffCell}
      />
      <DemandCellDrawer
        selection={drawers.demandSelection}
        demand={drawers.demandForSelection}
        currentOccupants={drawers.demandOccupants}
        suggestions={drawers.demandSuggestions}
        error={cellError}
        succeeded={cellSucceeded}
        onClose={drawers.closeDemandCell}
      />
    </main>
  );
}
