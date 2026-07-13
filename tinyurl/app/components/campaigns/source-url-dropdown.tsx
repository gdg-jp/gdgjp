import { Check, ChevronDown, Copy, Users } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { SOURCE_CODE_PATTERN, campaignSourceUrl } from "./source-url";

type SourceOption = { code: string; name: string };

export function SourceUrlDropdown({
  shortUrl,
  sources,
}: {
  shortUrl: string;
  sources: SourceOption[];
}) {
  const inputId = useId();
  const [source, setSource] = useState("");
  const [copied, setCopied] = useState(false);
  const normalized = source.trim().toLowerCase();
  const valid = normalized === "" || SOURCE_CODE_PATTERN.test(normalized);
  const url = useMemo(() => campaignSourceUrl(shortUrl, source), [shortUrl, source]);

  async function copyUrl() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Source URL copied");
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="shrink-0">
          <Users className="size-4" />
          Source
          <ChevronDown className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={inputId}>Registered or ad-hoc source</Label>
          <Input
            id={inputId}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="tokyo"
            maxLength={32}
            className="font-mono"
            aria-invalid={!valid}
          />
          {!valid ? (
            <p className="text-xs text-destructive">
              Use 1–32 letters, numbers, underscores, or hyphens.
            </p>
          ) : null}
        </div>

        {sources.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {sources.map((item) => (
              <Button
                key={item.code}
                type="button"
                variant={normalized === item.code ? "secondary" : "outline"}
                size="xs"
                onClick={() => setSource(item.code)}
                title={item.name}
              >
                {item.name}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="truncate rounded-md bg-muted px-2.5 py-2 font-mono text-xs text-muted-foreground">
            {url ?? shortUrl}
          </p>
          <Button type="button" className="w-full" size="sm" disabled={!url} onClick={copyUrl}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            Copy source URL
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
