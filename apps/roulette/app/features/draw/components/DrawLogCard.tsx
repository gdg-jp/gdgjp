import {
  Badge,
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  Heading,
  Icons,
  Stack,
  Text,
} from "@gdgjp/design-system";
import { rankLabel } from "~/features/prizes/odds";
import type { DrawLogEntry } from "../log";
import { drawNumberLabel, formatDrawTime } from "../result";

// The prize comes before the time: on a phone the table scrolls, and these two show first.
const columns: DataTableColumn<DrawLogEntry>[] = [
  { id: "number", header: "抽選番号", cell: (entry) => drawNumberLabel(entry.number) },
  {
    id: "prize",
    header: "景品",
    cell: (entry) => (
      <span className="flex items-center gap-2">
        <Badge tone={entry.rank === null ? "neutral" : entry.rank === 1 ? "warning" : "info"}>
          {rankLabel(entry.rank)}
        </Badge>
        {entry.name}
      </span>
    ),
  },
  { id: "time", header: "日時", cell: (entry) => formatDrawTime(entry.createdAt) },
];

/**
 * The latest spins, for checking a visitor's result screen at the prize desk.
 * Every spin is in the CSV.
 */
export function DrawLogCard({
  entries,
  total,
  csvUrl,
}: {
  /** Latest first. */
  entries: DrawLogEntry[];
  /** Every spin so far, including the ones not in `entries`. */
  total: number;
  csvUrl: string;
}) {
  return (
    <Card>
      <Stack>
        <div className="flex items-center gap-3">
          <Heading level={2} id="draw-log-heading" className="flex-1 text-lg">
            抽選ログ
          </Heading>
          {total > 0 && (
            <Button variant="outline" size="sm" asChild>
              <a href={csvUrl} download>
                <Icons name="Download" size={16} aria-hidden="true" />
                CSV をダウンロード
              </a>
            </Button>
          )}
        </div>
        <Text size="sm" tone="muted">
          {total > entries.length
            ? `新しい順に ${entries.length} 件を表示しています。${total} 件すべては CSV で確かめられます。`
            : "新しい順に表示しています。抽選結果をリセットすると消えます。"}
        </Text>
        <DataTable
          aria-labelledby="draw-log-heading"
          columns={columns}
          data={entries}
          getRowId={(entry) => String(entry.number)}
          emptyMessage="まだ抽選されていません"
        />
      </Stack>
    </Card>
  );
}
