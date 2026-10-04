import { useMemo, useState } from "react";
import { PublicShell } from "~/components/PublicShell";
import { PartyList } from "~/features/public-roster/components/PartyList";
import { PersonTimeline } from "~/features/public-roster/components/PersonTimeline";
import { PublicStaffGrid } from "~/features/public-roster/components/PublicStaffGrid";
import {
  PUBLIC_VIEWS,
  PUBLIC_VIEW_LABELS,
  type PublicRosterView,
  type PublicView,
} from "~/features/public-roster/types";
import { GridSearch } from "~/features/roster/components/GridSearch";
import { RoleGrid } from "~/features/roster/components/RoleGrid";
import { matchStaffIds } from "~/features/roster/search";
import { type Assignments, type Demand, assignmentKey, demandKey } from "~/features/solver/types";

/** Shared renderer for the compatibility event view and sheet-specific public views. */
export function PublicRosterPage({ loaderData }: { loaderData: PublicRosterView }) {
  const tracks = loaderData.published ? loaderData.data.tracks : [];
  const roles = loaderData.published ? loaderData.data.roles : [];
  const staff = loaderData.published ? loaderData.data.staff : [];
  const slots = loaderData.published ? loaderData.data.slots : [];
  const rawAssignments = loaderData.published ? loaderData.data.assignments : [];

  const trackInfoById = useMemo(
    () => new Map(tracks.map((t) => [t.id, { name: t.name, color: t.color }])),
    [tracks],
  );
  const roleNameById = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles]);
  const nameById = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff]);

  const assignments: Assignments = useMemo(() => {
    const map: Assignments = new Map();
    for (const a of rawAssignments) {
      map.set(assignmentKey(a.applicationId, a.timeSlotId), {
        trackId: a.trackId,
        roleId: a.roleId,
        locked: false,
      });
    }
    return map;
  }, [rawAssignments]);

  // The role grid needs a sortOrder on each track and role; derive it from
  // array position because the public wire type carries neither value.
  const roleViewTracks = useMemo(() => tracks.map((t, i) => ({ ...t, sortOrder: i })), [tracks]);
  const roleViewRoles = useMemo(() => roles.map((r, i) => ({ ...r, sortOrder: i })), [roles]);
  const roleViewDemands = useMemo(() => {
    const columns = new Map<string, { trackId: string; roleId: string }>();
    for (const a of rawAssignments) {
      columns.set(`${a.trackId}|${a.roleId}`, { trackId: a.trackId, roleId: a.roleId });
    }
    const map = new Map<string, Demand>();
    for (const slot of slots) {
      for (const { trackId, roleId } of columns.values()) {
        map.set(demandKey(slot.id, trackId, roleId), DUMMY_DEMAND);
      }
    }
    return map;
  }, [slots, rawAssignments]);

  const [view, setView] = useState<PublicView>("staff");
  const [search, setSearch] = useState("");
  // Same matcher the owner grid uses, over the only names this page has.
  const matchedIds = useMemo(() => matchStaffIds(search, staff), [search, staff]);

  if (!loaderData.published) {
    return (
      <PublicShell>
        <div className="page-heading">
          <div>
            <h1>
              {loaderData.event.name}
              {loaderData.event.sheet.name ? ` — ${loaderData.event.sheet.name}` : ""}
            </h1>
            <p>
              {loaderData.event.sheet.date} {loaderData.event.sheet.startTime}–
              {loaderData.event.sheet.endTime}
            </p>
          </div>
        </div>
        <p className="rounded-xl border border-border bg-surface p-5 font-medium">
          シフト表はまだ公開されていません。
        </p>
      </PublicShell>
    );
  }

  const { event } = loaderData.data;
  const visibleViews = PUBLIC_VIEWS.filter((v) => v !== "party" || event.hasParty);
  const timeSlotViews = slots.map((s) => ({
    id: s.id,
    idx: s.idx,
    start: s.startTime,
    end: s.endTime,
  }));
  const staffColumns = [...staff]
    .sort((a, b) => a.name.localeCompare(b.name, "ja"))
    .map((s) => ({ id: s.id, name: s.name }));

  return (
    <PublicShell wide>
      <div className="page-heading">
        <div>
          <h1>
            {event.name}
            {event.sheet.name ? ` — ${event.sheet.name}` : ""}
          </h1>
          <p>
            {event.sheet.date} {event.sheet.startTime}–{event.sheet.endTime}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="segmented">
          {visibleViews.map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}>
              {PUBLIC_VIEW_LABELS[v]}
            </button>
          ))}
        </div>
        {/* Shown on every tab — all four render names, and finding your own
         * shift on a phone is what this page is for. `key={view}` re-runs the
         * scroll against the newly mounted tab; see GridSearch's doc comment. */}
        <GridSearch
          key={view}
          query={search}
          onQueryChange={setSearch}
          matchCount={matchedIds.size}
        />
      </div>

      {view === "staff" ? (
        <PublicStaffGrid
          timeSlots={timeSlotViews}
          columns={staffColumns}
          assignments={assignments}
          trackById={trackInfoById}
          roleNameById={roleNameById}
          matchedIds={matchedIds}
        />
      ) : null}
      {view === "role" ? (
        <RoleGrid
          timeSlots={timeSlotViews}
          tracks={roleViewTracks}
          roles={roleViewRoles}
          demands={roleViewDemands}
          assignments={assignments}
          nameById={nameById}
          readOnly
          matchedIds={matchedIds}
        />
      ) : null}
      {view === "person" ? (
        <PersonTimeline
          staff={staffColumns}
          timeSlots={timeSlotViews}
          assignments={rawAssignments}
          trackById={trackInfoById}
          roleNameById={roleNameById}
          nameById={nameById}
          matchedIds={matchedIds}
        />
      ) : null}
      {view === "party" && event.hasParty ? (
        <PartyList staff={staff} matchedIds={matchedIds} />
      ) : null}
    </PublicShell>
  );
}

const DUMMY_DEMAND: Demand = { min: 0, ideal: 0, leadMin: 0, newMax: 0 };
