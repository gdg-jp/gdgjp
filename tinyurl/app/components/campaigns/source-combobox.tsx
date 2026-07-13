import { Check, ChevronDown } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { SOURCE_CODE_PATTERN } from "./source-url";

export type SourceOption = { code: string; name: string };

export function SourceCombobox({
  value,
  sources,
  onValueChange,
}: {
  value: string;
  sources: SourceOption[];
  onValueChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const normalized = value.trim().toLowerCase();
  const selected = sources.find((source) => source.code === normalized);
  const filtered = useMemo(() => {
    if (!normalized) return sources;
    return sources.filter(
      (source) =>
        source.code.includes(normalized) || source.name.toLowerCase().includes(normalized),
    );
  }, [normalized, sources]);

  function updateValue(next: string) {
    const candidate = next.trim().toLowerCase();
    if (candidate === "" || SOURCE_CODE_PATTERN.test(candidate)) onValueChange(candidate);
  }

  function selectSource(code: string) {
    onValueChange(code);
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (filtered.length === 0 ? -1 : (current + 1) % filtered.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        filtered.length === 0 ? -1 : current <= 0 ? filtered.length - 1 : current - 1,
      );
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      selectSource(filtered[activeIndex].code);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 max-w-44 min-w-32 justify-between gap-2 px-2 text-xs font-normal"
        >
          <span className="truncate">
            {selected ? `${selected.name} (${selected.code})` : normalized || "Select source"}
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="border-b p-2">
          <input
            ref={inputRef}
            type="text"
            aria-label="Source code"
            value={value}
            onChange={(event) => {
              updateValue(event.target.value);
              setActiveIndex(-1);
            }}
            onKeyDown={onKeyDown}
            placeholder="Type a source code…"
            maxLength={32}
            className="h-8 w-full bg-transparent px-2 font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-56 overflow-y-auto p-1">
          {!normalized ? (
            <button
              type="button"
              onClick={() => selectSource("")}
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              No source
            </button>
          ) : null}
          {filtered.map((source, index) => (
            <button
              key={source.code}
              type="button"
              aria-pressed={normalized === source.code}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => selectSource(source.code)}
              className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground ${
                activeIndex === index ? "bg-accent text-accent-foreground" : ""
              }`}
            >
              <span>
                {source.name}{" "}
                <span className="font-mono text-muted-foreground">({source.code})</span>
              </span>
              {normalized === source.code ? <Check className="size-4" /> : null}
            </button>
          ))}
          {filtered.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              This ad-hoc source will be used when copied.
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
