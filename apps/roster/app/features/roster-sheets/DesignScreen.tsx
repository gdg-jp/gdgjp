import { Card, Heading } from "@gdgjp/design-system";
import type { ReactNode } from "react";
import { DemandMatrix } from "../demand/components/DemandMatrix";
import type { SlotRowCounts } from "../demand/impact";
import type { Demand } from "../demand/types";
import type { EventRecord } from "../events/events.server";
import { PhaseList } from "../schedule/components/PhaseList";
import { RolePicker } from "../schedule/components/RolePicker";
import { TrackEditor } from "../schedule/components/TrackEditor";
import type { Role } from "../schedule/roles.server";
import type { Phase, TimeSlot } from "../schedule/schedule.server";
import type { Track } from "../schedule/tracks.server";
import { SheetHeader } from "./components/SheetHeader";
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
  actionData: { error?: string; section?: "roles" } | { ok?: boolean } | undefined;
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
  // Role-card errors render inside that card, next to the submitted form; the
  // page-top banner would be out of view after a submit near the card's bottom.
  const error = actionData && "error" in actionData ? actionData : undefined;
  const roleError = error?.section === "roles" ? error.error : undefined;
  const pageError = error?.section === "roles" ? undefined : error?.error;
  return (
    <main className="admin-page">
      <SheetHeader eventId={event.id} eventName={event.name} sheet={sheet} active="design" />
      {timeSlots.length === 0 && (
        <p className="rounded-lg border bg-background p-4 text-sm">
          このシフト表の準備を始めましょう。まず「フェーズと時間枠」で時間帯を追加し、次にトラックと役割、最後に需要を設定します。
        </p>
      )}
      {pageError ? (
        <p role="alert" className="text-sm font-medium text-gdg-red">
          {pageError}
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
          <RolePicker
            roles={roles}
            selectedRoleIds={eventRoleIds}
            sheetId={sheet.id}
            error={roleError}
          />
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
    <Card className="space-y-4">
      <Heading level={2}>{title}</Heading>
      {children}
    </Card>
  );
}
