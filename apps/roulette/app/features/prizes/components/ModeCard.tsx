import {
  Card,
  FormField,
  Heading,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  RadioGroup,
  RadioGroupItem,
  Stack,
  Text,
} from "@gdgjp/design-system";
import type { Draft, DraftErrors } from "../draft";
import type { Mode } from "../prize";

const options: { value: Mode; label: string; description: string }[] = [
  {
    value: "standard",
    label: "標準モード",
    description:
      "残りの個数に比例して当たります。∞ の景品は、想定人数から景品の個数を引いた数として数えます。",
  },
  {
    value: "custom",
    label: "カスタムモード",
    description:
      "景品ごとに当たる確率（%）を決めます。なくなった景品の分は、残っている景品に比率どおり配ります。",
  },
  {
    value: "evil",
    label: "悪徳モード",
    description:
      "「出さない」にした景品は当たりません。ほかの景品は標準モードと同じ割合で当たります。抽選画面には出さない景品も並びます。",
  },
];

export function ModeCard({
  draft,
  errors,
  pool,
  onChange,
}: {
  draft: Draft;
  errors: DraftErrors;
  /** What the unlimited prizes count as right now, for the standard and evil modes. */
  pool: number;
  onChange: (draft: Draft) => void;
}) {
  return (
    <Card>
      <Stack>
        <Heading level={2} className="text-lg">
          抽選モード
        </Heading>
        <RadioGroup
          aria-label="抽選モード"
          value={draft.mode}
          onValueChange={(value) => onChange({ ...draft, mode: value as Mode })}
          className="grid gap-4 md:grid-cols-3"
        >
          {options.map((option) => (
            <div key={option.value} className="flex items-start gap-3">
              <RadioGroupItem id={`mode-${option.value}`} value={option.value} className="mt-1" />
              <div className="min-w-0 flex-1">
                <label htmlFor={`mode-${option.value}`} className="font-semibold">
                  {option.label}
                </label>
                <Text size="sm" tone="muted">
                  {option.description}
                </Text>
              </div>
            </div>
          ))}
        </RadioGroup>
        {draft.mode !== "custom" && (
          <FormField
            label="想定人数"
            className="md:max-w-md"
            error={errors.expected}
            description={`∞ の景品は、いま ${pool} 個として数えます（想定人数 − 抽選済み − 景品の残り）。`}
          >
            <InputGroup className="md:max-w-48">
              <InputGroupInput
                inputMode="numeric"
                value={draft.expectedText}
                onChange={(event) => onChange({ ...draft, expectedText: event.target.value })}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>人</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          </FormField>
        )}
      </Stack>
    </Card>
  );
}
