import { SHORTAGE_KIND_LABELS, type SlotSupplyDemand } from "~/features/supply/supply";

/**
 * One time slot's supply-vs-demand row on `/e/:id/staff`'s supply-demand
 * view (docs/roster/05-staff-supply-demand.md "Design" §3). Need/available
 * are the slot-wide totals; the badges below them are the role-level
 * `head`/`lead` shortages, styled distinctly so the two kinds read as
 * visually different signals — red (harder blocker) for `head`, yellow
 * (softer) for `lead`, matching this app's existing severity convention
 * (`~/features/demand/components/DemandCell`'s `L≥`/`新≤` badges).
 */
export function SupplyDemandRow({
  slot,
  label,
  phaseName,
  roleNameById,
}: {
  slot: SlotSupplyDemand;
  label: string;
  phaseName: string | null;
  roleNameById: ReadonlyMap<string, string>;
}) {
  return (
    <li className="grid items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 sm:grid-cols-[minmax(180px,1fr)_auto_minmax(220px,1fr)]">
      <span>
        <span className="font-medium">{label}</span>
        {phaseName ? <span className="ml-2 text-sm text-neutral-500">{phaseName}</span> : null}
      </span>

      <span className="text-sm text-neutral-600">
        必要 {slot.need} / 稼働可能 {slot.available}
      </span>

      {slot.tight.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {slot.tight.map((shortage) => (
            <li
              key={`${shortage.roleId}-${shortage.kind}`}
              className={
                shortage.kind === "head"
                  ? "rounded-full bg-gdg-red/10 px-2 py-0.5 text-xs font-bold text-gdg-red"
                  : "rounded-full bg-gdg-yellow/20 px-2 py-0.5 text-xs font-bold text-neutral-700"
              }
            >
              {SHORTAGE_KIND_LABELS[shortage.kind]}:{" "}
              {roleNameById.get(shortage.roleId) ?? shortage.roleId}{" "}
              {shortage.kind === "lead" ? "リード" : ""}
              {shortage.lack}名不足
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
