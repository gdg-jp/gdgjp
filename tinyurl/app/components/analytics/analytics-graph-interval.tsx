import { Check, RotateCcw } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { type TimeBucketUnit, parseTimeBucket, timeBucketParam } from "~/lib/analytics-engine";

export function AnalyticsGraphInterval({ value, pending }: { value: string; pending: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = parseTimeBucket(value);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [unit, setUnit] = useState<TimeBucketUnit>(initial?.unit ?? "hour");
  const [error, setError] = useState("");

  useEffect(() => {
    const parsed = parseTimeBucket(value);
    setAmount(parsed ? String(parsed.amount) : "");
    setUnit(parsed?.unit ?? "hour");
    setError("");
  }, [value]);

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
    if (amount) next.set("bucket", timeBucketParam({ amount: numericAmount, unit }));
    else next.delete("bucket");
    setError("");
    setSearchParams(next, { preventScrollReset: true });
  }

  return (
    <form className="ml-2 flex flex-wrap items-center gap-1.5" onSubmit={applyInterval}>
      <Label htmlFor="analytics-graph-interval" className="text-xs text-muted-foreground">
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
        className="h-[30px] w-[60px] px-2 font-mono text-xs shadow-none"
      />
      <Select
        value={unit}
        onValueChange={(nextUnit) => setUnit(nextUnit as TimeBucketUnit)}
        disabled={pending}
      >
        <SelectTrigger
          size="sm"
          aria-label="Graph interval unit"
          className="w-20 px-2 text-xs shadow-none data-[size=sm]:h-[30px]"
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
      <Button
        type="submit"
        size="icon-xs"
        variant="ghost"
        disabled={pending}
        aria-label="Apply graph interval"
        title="Apply interval"
      >
        <Check className="size-3" />
      </Button>
      {value ? (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={pending}
          aria-label="Reset graph interval to automatic"
          title="Use automatic interval"
          onClick={() => {
            setAmount("");
            const next = new URLSearchParams(searchParams);
            next.delete("bucket");
            setSearchParams(next, { preventScrollReset: true });
          }}
        >
          <RotateCcw className="size-3" />
        </Button>
      ) : null}
      {error ? <span className="w-full text-xs text-destructive">{error}</span> : null}
    </form>
  );
}
