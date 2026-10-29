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
import type { Method } from "../prize";

const options: { value: Method; label: string; description: string }[] = [
  {
    value: "fixed",
    label: "確率を指定",
    description:
      "景品ごとに当たる確率（%）を決めます。なくなった景品の分は、残っている景品に比率どおり配ります。",
  },
  {
    value: "box",
    label: "くじ箱",
    description: "想定人数ぶんのくじを箱から引くように、残りの枚数に比例して当たります。",
  },
  {
    value: "equal",
    label: "均等",
    description: "残っている景品のどれかが、同じ確率で当たります。",
  },
];

export function MethodCard({
  draft,
  errors,
  pool,
  onChange,
}: {
  draft: Draft;
  errors: DraftErrors;
  /** Losing tickets left in the box, for the "box" description. */
  pool: number;
  onChange: (draft: Draft) => void;
}) {
  return (
    <Card>
      <Stack>
        <Heading level={2} className="text-lg">
          抽選方式
        </Heading>
        <RadioGroup
          aria-label="抽選方式"
          value={draft.method}
          onValueChange={(value) => onChange({ ...draft, method: value as Method })}
          className="grid gap-4 md:grid-cols-3"
        >
          {options.map((option) => (
            <div key={option.value} className="flex items-start gap-3">
              <RadioGroupItem id={`method-${option.value}`} value={option.value} className="mt-1" />
              <div className="min-w-0 flex-1">
                <label htmlFor={`method-${option.value}`} className="font-semibold">
                  {option.label}
                </label>
                <Text size="sm" tone="muted">
                  {option.description}
                </Text>
                {option.value === "box" && draft.method === "box" && (
                  <FormField
                    label="想定人数"
                    className="mt-3"
                    error={errors.expected}
                    description={`∞ の景品は、いま ${pool} 枚として数えます（想定人数 − 抽選済み − 景品の残り）。`}
                  >
                    <InputGroup>
                      <InputGroupInput
                        inputMode="numeric"
                        value={draft.expectedText}
                        onChange={(event) =>
                          onChange({ ...draft, expectedText: event.target.value })
                        }
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>人</InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
                  </FormField>
                )}
              </div>
            </div>
          ))}
        </RadioGroup>
      </Stack>
    </Card>
  );
}
