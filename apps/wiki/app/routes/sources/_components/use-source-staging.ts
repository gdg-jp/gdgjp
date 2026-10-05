import { useEffect, useMemo, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { titleFromUrl } from "~/features/sources/staged-candidates";
import type { StagedSource } from "~/features/sources/staged-candidates";
import type { action } from "../page";

/**
 * Local staging state for the `/sources` add-source panel: candidates picked
 * from Drive / Chat / Discord / URLs, their per-candidate errors, and the batch
 * submit fetcher. `registeredCandidateIds` folds in already-imported sources so
 * the pickers can disable duplicates.
 */
export function useSourceStaging(
  sources: ReadonlyArray<{ externalId: string | null; kind: string }>,
) {
  const revalidator = useRevalidator();
  const batchFetcher = useFetcher<typeof action>();
  const [candidates, setCandidates] = useState<StagedSource[]>([]);
  const [candidateErrors, setCandidateErrors] = useState<Record<string, string>>({});

  const registeredCandidateIds = useMemo(() => {
    const ids = new Set<string>();
    for (const source of sources) {
      if (!source.externalId) continue;
      if (source.kind === "google-chat-space") {
        ids.add(`chat:${source.externalId}`);
      } else if (source.kind === "discord-channel") {
        ids.add(`discord:${source.externalId}`);
      } else {
        ids.add(`drive:${source.externalId}`);
      }
    }
    for (const candidate of candidates) {
      if (candidate.kind === "discord-channel") ids.add(candidate.id);
      if (candidate.kind === "google-chat-space") ids.add(candidate.id);
    }
    return ids;
  }, [sources, candidates]);

  useEffect(() => {
    if (!batchFetcher.data?.ok || !("addedIds" in batchFetcher.data) || !batchFetcher.data.failed) {
      return;
    }
    const addedIds = new Set(batchFetcher.data.addedIds);
    setCandidates((current) => current.filter((candidate) => !addedIds.has(candidate.id)));
    setCandidateErrors(
      Object.fromEntries(batchFetcher.data.failed.map((failure) => [failure.id, failure.error])),
    );
    if (addedIds.size > 0) revalidator.revalidate();
  }, [batchFetcher.data, revalidator]);

  function addCandidates(next: StagedSource[]): boolean {
    const fresh: StagedSource[] = [];
    let hadDuplicate = false;
    for (const candidate of next) {
      if (registeredCandidateIds.has(candidate.id)) {
        hadDuplicate = true;
        continue;
      }
      fresh.push(candidate);
    }
    if (fresh.length === 0) return hadDuplicate;
    setCandidates((current) => {
      const byId = new Map(current.map((candidate) => [candidate.id, candidate]));
      for (const candidate of fresh) byId.set(candidate.id, candidate);
      return [...byId.values()];
    });
    setCandidateErrors((current) => {
      const nextErrors = { ...current };
      for (const candidate of fresh) delete nextErrors[candidate.id];
      return nextErrors;
    });
    return hadDuplicate;
  }

  function removeCandidate(id: string) {
    setCandidates((current) => current.filter((candidate) => candidate.id !== id));
    setCandidateErrors((current) => {
      const nextErrors = { ...current };
      delete nextErrors[id];
      return nextErrors;
    });
  }

  function addUrlCandidate() {
    const id = `url:${crypto.randomUUID()}`;
    setCandidates((current) => [...current, { id, kind: "url", title: "", url: "" }]);
    setCandidateErrors((current) => {
      const nextErrors = { ...current };
      delete nextErrors[id];
      return nextErrors;
    });
  }

  function updateUrlCandidate(id: string, url: string) {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.id === id && candidate.kind === "url"
          ? { ...candidate, url, title: url.trim() ? titleFromUrl(url.trim()) : "" }
          : candidate,
      ),
    );
  }

  return {
    candidates,
    candidateErrors,
    registeredCandidateIds,
    batchFetcher,
    addCandidates,
    removeCandidate,
    addUrlCandidate,
    updateUrlCandidate,
  };
}
