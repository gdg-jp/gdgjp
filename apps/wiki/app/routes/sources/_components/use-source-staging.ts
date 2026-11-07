import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { REGISTRATIONS, sourceKindSpec } from "~/features/sources/kinds";
import { MAX_BATCH_CANDIDATES, titleFromUrl } from "~/features/sources/staged-candidates";
import type { StagedSource } from "~/features/sources/staged-candidates";
import type { action } from "../page";

type BatchFields = { visibility: string; chapter: string };

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
      const spec = sourceKindSpec(source.kind);
      if (spec) ids.add(spec.candidateId(source.externalId));
    }
    for (const candidate of candidates) {
      if (REGISTRATIONS[candidate.kind].dedupeStaged) ids.add(candidate.id);
    }
    return ids;
  }, [sources, candidates]);

  // A batch larger than one request allows (a picked Drive folder) is sent in chunks: each
  // response removes what was added, then the next chunk goes out. `queue` holds the rest.
  const queue = useRef<{ rest: StagedSource[]; fields: BatchFields } | null>(null);
  const handled = useRef<unknown>(null);
  const [chunking, setChunking] = useState(false);

  function submitChunk(chunk: StagedSource[], fields: BatchFields) {
    batchFetcher.submit(
      { intent: "create-batch", ...fields, candidates: JSON.stringify(chunk) },
      { method: "post" },
    );
  }

  function submitBatch(fields: BatchFields) {
    if (candidates.length === 0) return;
    setCandidateErrors({});
    queue.current = { rest: candidates.slice(MAX_BATCH_CANDIDATES), fields };
    setChunking(candidates.length > MAX_BATCH_CANDIDATES);
    submitChunk(candidates.slice(0, MAX_BATCH_CANDIDATES), fields);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per batch response.
  useEffect(() => {
    const data = batchFetcher.data;
    if (!data || handled.current === data) return;
    handled.current = data;
    if (!data.ok || !("addedIds" in data) || !data.failed) {
      queue.current = null;
      setChunking(false);
      return;
    }
    const addedIds = new Set(data.addedIds);
    const failed = data.failed;
    setCandidates((current) => current.filter((candidate) => !addedIds.has(candidate.id)));
    setCandidateErrors((current) => ({
      ...current,
      ...Object.fromEntries(failed.map((failure) => [failure.id, failure.error])),
    }));
    if (addedIds.size > 0) revalidator.revalidate();
    const pending = queue.current;
    if (pending && pending.rest.length > 0) {
      const next = pending.rest.slice(0, MAX_BATCH_CANDIDATES);
      pending.rest = pending.rest.slice(MAX_BATCH_CANDIDATES);
      submitChunk(next, pending.fields);
    } else {
      queue.current = null;
      setChunking(false);
    }
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
        candidate.id === id && REGISTRATIONS[candidate.kind].editableUrl
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
    submitting: chunking || batchFetcher.state !== "idle",
    submitBatch,
    addCandidates,
    removeCandidate,
    addUrlCandidate,
    updateUrlCandidate,
  };
}
