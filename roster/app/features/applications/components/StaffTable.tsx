import type { ReactNode } from "react";
import {
  LEVEL_LABELS,
  type Level,
  PARTY_LABELS,
  type PartyStatus,
  type Pref,
  UPDATED_BY_LABELS,
  type UpdatedBy,
} from "~/features/applications/types";

export type StaffRoleTag = { roleId: string; roleName: string; level: Level; pref: Pref };

/** One row of the `/e/:id/staff` staff list (docs/roster/05-staff-supply-demand.md "Design" §2). */
export type StaffRow = {
  applicationId: string;
  name: string;
  withdrawn: boolean;
  roles: StaffRoleTag[];
  /** Count of `o` (fully available) time slots. */
  availableCount: number;
  /** Count of `d` (available only if `o` doesn't fill the slot) time slots. */
  softAvailableCount: number;
  party: PartyStatus;
  updatedBy: UpdatedBy;
  updatedAt: string;
};

/**
 * The staff list table. `hasParty` hides the 懇親会 column entirely when the
 * event has no party (docs/roster/05-staff-supply-demand.md "Design" §2) —
 * clicking a row opens `StaffDrawer` for owner corrections, via `onSelect`.
 */
export function StaffTable({
  rows,
  hasParty,
  onSelect,
}: {
  rows: readonly StaffRow[];
  hasParty: boolean;
  onSelect: (applicationId: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-600">まだ登録がありません。</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b-2 border-border">
            <Th>氏名</Th>
            <Th>担当可能役割</Th>
            <Th>稼働可能な枠数</Th>
            {hasParty ? <Th>懇親会</Th> : null}
            <Th>最終更新</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.applicationId}
              tabIndex={0}
              onClick={() => onSelect(row.applicationId)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                onSelect(row.applicationId);
              }}
              className="cursor-pointer border-b border-neutral-200 last:border-b-0 hover:bg-neutral-50 focus:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-gdg-blue/40"
            >
              <td className="p-3">
                <span className={row.withdrawn ? "text-neutral-400 line-through" : "font-medium"}>
                  {row.name}
                </span>
                {row.withdrawn ? (
                  <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs font-bold text-neutral-500">
                    辞退
                  </span>
                ) : null}
              </td>
              <td className="p-3">
                <ul className="flex flex-wrap gap-1">
                  {row.roles.map((role) => (
                    <li
                      key={role.roleId}
                      className="rounded-full border border-border px-2 py-0.5 text-xs"
                    >
                      {role.roleName} · {LEVEL_LABELS[role.level]}
                      {role.pref === 1 ? " · 第1希望" : ""}
                    </li>
                  ))}
                </ul>
              </td>
              <td className="p-3 whitespace-nowrap">
                ○ {row.availableCount} / △ {row.softAvailableCount}
              </td>
              {hasParty ? <td className="p-3">{PARTY_LABELS[row.party]}</td> : null}
              <td className="p-3 whitespace-nowrap text-neutral-600">
                {row.updatedAt.slice(0, 10)} · {UPDATED_BY_LABELS[row.updatedBy]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="p-3 font-bold">{children}</th>;
}
