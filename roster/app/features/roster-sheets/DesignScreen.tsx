import { Link as UiLink } from "@gdgjp/design-system";
import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router";
import { DemandMatrix } from "../demand/components/DemandMatrix";
import type { SlotRowCounts } from "../demand/impact";
import type { Demand } from "../demand/types";
import type { EventRecord } from "../events/events.server";
import { PhaseList } from "../schedule/components/PhaseList";
import { RolePicker } from "../schedule/components/RolePicker";
import { TrackEditor } from "../schedule/components/TrackEditor";
import type { Phase, TimeSlot } from "../schedule/schedule.server";
import type { Role, Track } from "../schedule/tracks.server";
import { SheetSettingsForm } from "./components/SheetSettingsForm";
import type { RosterSheet } from "./types";

type DesignScreenProps = {
  loaderData: {
    event: EventRecord;
    sheet: RosterSheet;
    phases: Phase[];
    timeSlots: TimeSlot[];
    tracks: Track[];
    roles: Role[];
    eventRoleIds: string[];
    demands: Demand[];
    availabilityCounts: SlotRowCounts;
    assignmentCounts: SlotRowCounts;
  };
  actionData: { error?: string } | { ok?: boolean } | undefined;
};

export default function DesignScreen({ loaderData, actionData }: DesignScreenProps) {
  const {
    event,
    sheet,
    phases,
    timeSlots,
    tracks,
    roles,
    eventRoleIds,
    demands,
    availabilityCounts,
    assignmentCounts,
  } = loaderData;
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
            availabilityCounts={availabilityCounts}
            assignmentCounts={assignmentCounts}
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
    <section className="space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}
