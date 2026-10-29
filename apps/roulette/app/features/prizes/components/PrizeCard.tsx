import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  FormField,
  Heading,
  IconButton,
  Icons,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  Stack,
  Text,
} from "@gdgjp/design-system";
import {
  type Draft,
  type DraftErrors,
  type DraftPrize,
  MAX_NAME_LENGTH,
  addRow,
  draftRank,
  hasErrors,
  moveRow,
  percentTotal,
} from "../draft";
import { formatOdds } from "../odds";
import { MAX_PRIZES, type Method } from "../prize";

const fixedCols = "md:grid-cols-[3.5rem_minmax(0,1fr)_9rem_6.5rem_5rem_5rem_6.5rem] md:gap-x-3";
const plainCols = "md:grid-cols-[3.5rem_minmax(0,1fr)_9rem_5rem_5rem_6.5rem] md:gap-x-3";

function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) return <Badge>ハズレ</Badge>;
  return <Badge tone={rank === 1 ? "warning" : "info"}>{rank} 等</Badge>;
}

function PrizeRow({
  index,
  row,
  rank,
  won,
  odds,
  method,
  errors,
  isFirst,
  isLast,
  onChange,
  onMove,
  onDelete,
}: {
  index: number;
  row: DraftPrize;
  rank: number | null;
  won: number;
  odds: number | null;
  method: Method;
  errors: DraftErrors;
  isFirst: boolean;
  isLast: boolean;
  onChange: (row: DraftPrize) => void;
  onMove: (by: -1 | 1) => void;
  onDelete: () => void;
}) {
  const n = index + 1;
  // Column headers name the fields on wide screens; labels show on phones.
  const suffix = <span className="sr-only">（{n} 行目）</span>;
  const stock = Number(row.stockText) || 0;
  return (
    <div
      className={`grid grid-cols-2 gap-x-3 gap-y-2 rounded-md border border-border p-3 md:items-start md:rounded-none md:border-0 md:p-0 ${
        method === "fixed" ? fixedCols : plainCols
      }`}
    >
      <div className="col-span-2 flex items-center md:col-span-1 md:h-10">
        <RankBadge rank={rank} />
      </div>
      <FormField
        className="col-span-2 md:col-span-1 md:[&>label]:sr-only"
        label={<>景品名{suffix}</>}
        error={errors.name?.[row.id]}
      >
        <Input
          value={row.name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(event) => onChange({ ...row, name: event.target.value })}
        />
      </FormField>
      <FormField
        className="md:[&>label]:sr-only"
        label={<>個数{suffix}</>}
        error={errors.stock?.[row.id]}
      >
        <div className="flex items-center gap-2">
          <Input
            inputMode="numeric"
            className="w-20"
            value={row.unlimited ? "" : row.stockText}
            placeholder={row.unlimited ? "∞" : undefined}
            disabled={row.unlimited}
            onChange={(event) => onChange({ ...row, stockText: event.target.value })}
          />
          <Checkbox
            id={`unlimited-${row.id}`}
            checked={row.unlimited}
            aria-label={`個数を ∞ にする（${n} 行目）`}
            onCheckedChange={(checked) => onChange({ ...row, unlimited: checked === true })}
          />
          <label htmlFor={`unlimited-${row.id}`} aria-hidden="true" className="text-lg">
            ∞
          </label>
        </div>
      </FormField>
      {method === "fixed" && (
        <FormField
          className="md:[&>label]:sr-only"
          label={<>確率{suffix}</>}
          error={errors.percent?.[row.id]}
        >
          <InputGroup>
            <InputGroupInput
              inputMode="decimal"
              value={row.percentText}
              onChange={(event) => onChange({ ...row, percentText: event.target.value })}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>%</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </FormField>
      )}
      <div className="flex items-center gap-1 text-sm tabular-nums md:h-10">
        <span className="text-muted md:sr-only">残り</span>
        {row.unlimited ? (
          "∞"
        ) : (
          <span>
            <strong>{Math.max(stock - won, 0)}</strong>
            <span className="text-muted"> / {stock}</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 text-sm tabular-nums md:h-10">
        <span className="text-muted md:sr-only">今の確率</span>
        <strong>{odds === null ? "—" : formatOdds(odds)}</strong>
      </div>
      <div className="col-span-2 flex items-center justify-end gap-1 md:col-span-1 md:h-10">
        <IconButton
          variant="ghost"
          size="sm"
          aria-label={`${n} 行目を上へ`}
          disabled={isFirst}
          onClick={() => onMove(-1)}
        >
          <Icons name="ArrowUp" size={16} aria-hidden="true" />
        </IconButton>
        <IconButton
          variant="ghost"
          size="sm"
          aria-label={`${n} 行目を下へ`}
          disabled={isLast}
          onClick={() => onMove(1)}
        >
          <Icons name="ArrowDown" size={16} aria-hidden="true" />
        </IconButton>
        <IconButton variant="ghost" size="sm" aria-label={`${n} 行目を削除`} onClick={onDelete}>
          <Icons name="Trash2" size={16} aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}

/** The prize table: name, stock (or ∞), % for "fixed", what is left and the odds now. */
export function PrizeCard({
  draft,
  errors,
  odds,
  wonOf,
  onChange,
}: {
  draft: Draft;
  errors: DraftErrors;
  /** Odds per row, or null while they cannot be computed (the % do not add up). */
  odds: number[] | null;
  wonOf: (id: string) => number;
  onChange: (draft: Draft) => void;
}) {
  const full = draft.prizes.length >= MAX_PRIZES;
  const total = percentTotal(draft);
  return (
    <Card>
      <Stack>
        <div className="flex items-baseline gap-3">
          <Heading level={2} className="flex-1 text-lg">
            景品
          </Heading>
          <Text size="sm" tone="muted" className="tabular-nums">
            {draft.prizes.length} / {MAX_PRIZES}
          </Text>
        </div>
        <Text size="sm" tone="muted">
          上の行から 1 等、2 等…になります。個数を ∞ にした行はハズレ枠です。
        </Text>
        {hasErrors(errors) && (
          <Alert tone="danger" title={errors.list ?? "赤字の項目を直してから保存してください"} />
        )}
        <div
          aria-hidden="true"
          className={`hidden text-sm text-muted md:grid ${draft.method === "fixed" ? fixedCols : plainCols}`}
        >
          <span>等級</span>
          <span>景品名</span>
          <span>個数</span>
          {draft.method === "fixed" && <span>確率</span>}
          <span>残り</span>
          <span>今の確率</span>
          <span />
        </div>
        <Stack className="gap-3">
          {draft.prizes.map((row, index) => (
            <PrizeRow
              key={row.id}
              index={index}
              row={row}
              rank={draftRank(draft, index)}
              won={wonOf(row.id)}
              odds={odds ? (odds[index] ?? 0) : null}
              method={draft.method}
              errors={errors}
              isFirst={index === 0}
              isLast={index === draft.prizes.length - 1}
              onChange={(next) =>
                onChange({
                  ...draft,
                  prizes: draft.prizes.map((item) => (item.id === row.id ? next : item)),
                })
              }
              onMove={(by) => onChange(moveRow(draft, index, by))}
              onDelete={() =>
                onChange({ ...draft, prizes: draft.prizes.filter((item) => item.id !== row.id) })
              }
            />
          ))}
        </Stack>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={full}
            onClick={() => onChange(addRow(draft, crypto.randomUUID()))}
          >
            <Icons name="Plus" size={16} aria-hidden="true" />
            景品を追加
          </Button>
          {full && (
            <Text size="sm" tone="muted">
              景品は {MAX_PRIZES} 個までです
            </Text>
          )}
          {draft.method === "fixed" && (
            <p
              className={`ml-auto text-sm tabular-nums ${total === 100 ? "text-muted" : "font-semibold text-danger"}`}
            >
              確率の合計 {total}%
            </p>
          )}
        </div>
      </Stack>
    </Card>
  );
}
