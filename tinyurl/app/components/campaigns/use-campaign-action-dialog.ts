import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

export type CampaignActionData = { ok: true } | { error: string };

export function useCampaignActionDialog() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetcher = useFetcher<CampaignActionData>();
  const handledData = useRef<CampaignActionData | undefined>(undefined);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || fetcher.data === handledData.current) return;
    handledData.current = fetcher.data;
    if ("error" in fetcher.data) {
      setError(fetcher.data.error);
    } else {
      setOpen(false);
      setError(null);
    }
  }, [fetcher.data, fetcher.state]);

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
