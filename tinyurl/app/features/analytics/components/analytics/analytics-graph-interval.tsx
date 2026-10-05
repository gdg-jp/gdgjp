import {
  IconButton,
  Icons,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@gdgjp/design-system";
import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import {
  type TimeBucketUnit,
  parseTimeBucket,
  timeBucketParam,
} from "~/features/analytics/analytics-engine";

export function AnalyticsGraphInterval({
  value,
  pending,
  paramName = "bucket",
  defaultUnit = "hour",
}: {
  value: string;
  pending: boolean;
  paramName?: string;
  defaultUnit?: TimeBucketUnit;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = parseTimeBucket(value);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [unit, setUnit] = useState<TimeBucketUnit>(initial?.unit ?? defaultUnit);
  const [error, setError] = useState("");

  useEffect(() => {
    const parsed = parseTimeBucket(value);
    setAmount(parsed ? String(parsed.amount) : "");
    setUnit(parsed?.unit ?? defaultUnit);
    setError("");
  }, [value, defaultUnit]);

  function applyInterval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (
      amount &&
      (!Number.isInteger(numericAmount) || numericAmount <= 0 || numericAmount > 9999)
    ) {
      setError("Enter a whole number from 1 to 9999.");
      return;
    }

    const next = new URLSearchParams(searchParams);
    if (amount) next.set(paramName, timeBucketParam({ amount: numericAmount, unit }));
    else next.delete(paramName);
    setError("");
    setSearchParams(next, { preventScrollReset: true });
  }

  return (
    <form className="ml-2 flex flex-wrap items-center gap-1.5" onSubmit={applyInterval}>
      <Label htmlFor="analytics-graph-interval" className="text-xs text-muted">
        Interval
      </Label>
      <Input
        id="analytics-graph-interval"
        type="number"
        inputMode="numeric"
        min={1}
        max={9999}
        step={1}
        value={amount}
        onChange={(event) => {
          setAmount(event.target.value);
          setError("");
        }}
        placeholder="Auto"
        aria-label="Graph interval amount"
        aria-invalid={Boolean(error)}
        disabled={pending}
        className="h-8 w-20 shrink-0 px-2 font-mono text-sm shadow-none"
      />
      <Select
        value={unit}
        onValueChange={(nextUnit) => setUnit(nextUnit as TimeBucketUnit)}
        disabled={pending}
      >
        <SelectTrigger
          aria-label="Graph interval unit"
          className="h-8 min-w-24 shrink-0 gap-2 px-2 text-sm shadow-none"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="minute">Minutes</SelectItem>
          <SelectItem value="hour">Hours</SelectItem>
          <SelectItem value="day">Days</SelectItem>
          <SelectItem value="week">Weeks</SelectItem>
        </SelectContent>
      </Select>
      <IconButton
        size="sm"
        type="submit"
        variant="ghost"
        disabled={pending}
        aria-label="Apply graph interval"
        title="Apply interval"
      >
        <Icons name="Check" aria-hidden="true" className="size-3" />
      </IconButton>
      {value ? (
        <IconButton
          size="sm"
          type="button"
          variant="ghost"
          disabled={pending}
          aria-label="Reset graph interval to automatic"
          title="Use automatic interval"
          onClick={() => {
            setAmount("");
            const next = new URLSearchParams(searchParams);
            next.delete(paramName);
            setSearchParams(next, { preventScrollReset: true });
          }}
        >
          <Icons name="RotateCcw" aria-hidden="true" className="size-3" />
        </IconButton>
      ) : null}
      {error ? <span className="w-full text-xs text-danger">{error}</span> : null}
    </form>
  );
}
