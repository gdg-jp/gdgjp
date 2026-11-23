import { SHORTAGE_KIND_LABELS, type ShortageSummaryEntry } from "~/features/supply/supply";

export function ShortageSummary({
  registeredCount,
  shortages,
  roleNameById,
}: {
  registeredCount: number;
  shortages: readonly ShortageSummaryEntry[];
  roleNameById: ReadonlyMap<string, string>;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h2 className="font-semibold">需給サマリ</h2>
      <p>
        登録スタッフ数: <span className="font-bold">{registeredCount}</span> 名（辞退を除く）
      </p>

      {shortages.length > 0 ? (
        <div>
          <h3 className="text-sm font-medium">不足している役割</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {shortages.map((shortage) => (
              <li
                key={`${shortage.roleId}-${shortage.kind}`}
                className="rounded-full border-2 border-border bg-surface px-3 py-1 text-sm"
              >
                {roleNameById.get(shortage.roleId) ?? shortage.roleId}の
                {SHORTAGE_KIND_LABELS[shortage.kind]}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-neutral-600">現時点で不足している役割はありません。</p>
      )}

      <p className="text-xs text-neutral-500">
        候補数は同時配置可能数ではありません。実際の配置可否はシフト生成で判定します。
      </p>
    </section>
  );
}
