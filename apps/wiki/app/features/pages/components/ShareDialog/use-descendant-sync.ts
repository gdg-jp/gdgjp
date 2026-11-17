import { useCallback, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { AccessData } from "./types";

type DescendantSnapshot = Required<Pick<AccessData, "descendantCount" | "syncedDescendantCount">>;
type DescendantPrompt =
  | { kind: "closed" }
  | {
      kind: "ready" | "submitting" | "completed";
      snapshot: DescendantSnapshot;
      includeUnsynced: boolean;
    };

export function useDescendantSync(pageId: string) {
  const descendantFetcher = useFetcher<{
    ok?: boolean;
    error?: string;
    updatedCount?: number;
    unsyncedSkippedCount?: number;
    permissionSkippedCount?: number;
    permissionSkipped?: Array<{ id: string; title: string }>;
  }>();
  const { reset } = descendantFetcher;
  const [prompt, setPrompt] = useState<DescendantPrompt>({ kind: "closed" });
  const resetDescendantPrompt = useCallback(() => {
    reset();
    setPrompt({ kind: "closed" });
  }, [reset]);

  useEffect(() => {
    if (prompt.kind !== "submitting" || descendantFetcher.state !== "idle") return;
    if (descendantFetcher.data) setPrompt({ ...prompt, kind: "completed" });
  }, [descendantFetcher.data, descendantFetcher.state, prompt]);

  function promptDescendantSync(access: AccessData | undefined) {
    if (!access?.descendantCount) return;
    reset();
    setPrompt({
      kind: "ready",
      snapshot: {
        descendantCount: access.descendantCount,
        syncedDescendantCount: access.syncedDescendantCount ?? 0,
      },
      includeUnsynced: false,
    });
  }

  function setShowDescendantDialog(open: boolean) {
    if (!open) resetDescendantPrompt();
  }

  function setIncludeUnsyncedDescendants(includeUnsynced: boolean) {
    if (prompt.kind === "ready") setPrompt({ ...prompt, includeUnsynced });
  }

  function syncDescendants() {
    if (prompt.kind === "closed" || prompt.kind === "submitting") return;
    setPrompt({ ...prompt, kind: "submitting" });
    descendantFetcher.submit(
      JSON.stringify({ intent: "syncDescendants", includeUnsynced: prompt.includeUnsynced }),
      { method: "post", action: `/api/page-access/${pageId}`, encType: "application/json" },
    );
  }

  const descendantCount = prompt.kind === "closed" ? 0 : prompt.snapshot.descendantCount;
  const syncedDescendantCount =
    prompt.kind === "closed" ? 0 : prompt.snapshot.syncedDescendantCount;
  const includeUnsyncedDescendants = prompt.kind !== "closed" && prompt.includeUnsynced;

  return {
    descendantFetcher,
    promptDescendantSync,
    resetDescendantPrompt,
    showDescendantDialog: prompt.kind !== "closed",
    setShowDescendantDialog,
    includeUnsyncedDescendants,
    setIncludeUnsyncedDescendants,
    descendantRequestCompleted: prompt.kind === "completed",
    syncDescendants,
    descendantCount,
    syncedDescendantCount,
    hasUnsyncedDescendants: descendantCount > syncedDescendantCount,
    canSyncDescendants: includeUnsyncedDescendants
      ? descendantCount > 0
      : syncedDescendantCount > 0,
  };
}
