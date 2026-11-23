import { PARTY_LABELS, PARTY_STATUSES, type PartyStatus } from "~/features/applications/types";
import type { PublicStaff } from "../types";

export function PartyList({
  staff,
  matchedIds,
}: {
  staff: readonly PublicStaff[];
  matchedIds?: ReadonlySet<string>;
}) {
  const displayOrder: readonly PartyStatus[] = ["yes", "undecided", "no"];
  const groups = new Map<PartyStatus, PublicStaff[]>(PARTY_STATUSES.map((s) => [s, []]));
  for (const member of staff) groups.get(member.party)?.push(member);

  return (
    <div className="space-y-4">
      {displayOrder.map((status) => {
        const members = groups.get(status) ?? [];
        return (
          <section key={status} className="rounded-xl border-2 border-border bg-surface p-4">
            <h3 className="font-bold">
              {PARTY_LABELS[status]}（{members.length}人）
            </h3>
            {members.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {members.map((m) => {
                  const matched = matchedIds?.has(m.id) ?? false;
                  return (
                    <li
                      key={m.id}
                      className="rounded-full border-2 border-border bg-surface px-3 py-1 text-sm"
                      data-search-match={matched ? "true" : undefined}
                    >
                      {matched ? <span className="grid-match">{m.name}</span> : m.name}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-neutral-500">該当者なし</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
