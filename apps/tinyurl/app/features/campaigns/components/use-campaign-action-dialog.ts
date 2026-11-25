import { useValueChange } from "@gdgjp/gdg-lib/react";
import { useState } from "react";
import { useFetcher } from "react-router";

export type CampaignActionData = { ok: true } | { error: string };

export function useCampaignActionDialog() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetcher = useFetcher<CampaignActionData>();
  useValueChange(fetcher.state === "idle" ? fetcher.data : undefined, (data) => {
    if (!data) return;
    if ("error" in data) {
      setError(data.error);
    } else {
      setOpen(false);
      setError(null);
    }
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) setError(null);
  }

  return {
    open,
    onOpenChange,
    fetcher,
    pending: fetcher.state !== "idle",
    error,
  };
}
