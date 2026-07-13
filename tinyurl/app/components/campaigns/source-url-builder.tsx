import { Check, Copy, Link2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { SOURCE_CODE_PATTERN, campaignSourceUrl } from "./source-url";

export type CampaignSourceOption = { code: string; name: string };

export function SourceUrlBuilder({
  shortUrl,
  sources,
}: {
  shortUrl: string;
  sources: CampaignSourceOption[];
}) {
  const [registered, setRegistered] = useState("");
  const [custom, setCustom] = useState("");
  const [copied, setCopied] = useState(false);
  const source = (custom || registered).trim().toLowerCase();
  const valid = source === "" || SOURCE_CODE_PATTERN.test(source);
  const url = useMemo(() => {
    if (!source || !valid) return shortUrl;
    return campaignSourceUrl(shortUrl, source) ?? shortUrl;
  }, [shortUrl, source, valid]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <Link2 className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Source URL</h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`registered-${shortUrl}`}>Registered source</Label>
          <Select
            value={registered}
            onValueChange={(value) => {
              setRegistered(value);
              setCustom("");
            }}
          >
            <SelectTrigger id={`registered-${shortUrl}`} className="w-full">
              <SelectValue placeholder="Select a source" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((item) => (
                <SelectItem key={item.code} value={item.code}>
                  {item.name} ({item.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`custom-${shortUrl}`}>Ad-hoc source</Label>
          <Input
            id={`custom-${shortUrl}`}
            value={custom}
            onChange={(event) => {
              setCustom(event.target.value);
              setRegistered("");
            }}
            maxLength={32}
            placeholder="tokyo"
            className="font-mono"
            aria-invalid={!valid}
          />
        </div>
      </div>
      {!valid ? (
        <p className="text-xs text-destructive">
          Use 1–32 lowercase letters, numbers, underscores, or hyphens.
        </p>
      ) : null}
      <div className="flex gap-2">
        <Input readOnly value={url} className="min-w-0 font-mono text-xs" />
        <Button type="button" variant="outline" size="icon" onClick={copy} disabled={!valid}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          <span className="sr-only">Copy source URL</span>
        </Button>
      </div>
    </div>
  );
}
