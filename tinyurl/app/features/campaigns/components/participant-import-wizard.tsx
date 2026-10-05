import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  FormField,
  Icons,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  cn,
} from "@gdgjp/design-system";
import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { validateParticipantImport } from "~/features/campaigns/campaign-participant-import-validation";
export type CampaignChannelOption = {
  id: number;
  name: string;
  code: string;
};

export type DiscoveryQuestionDraft = {
  id: string;
  label: string;
};

export type AnswerMappingDraft = {
  questionId: string;
  questionLabel: string;
  answer: string;
  channelIds: string[];
};

export type ConnpassImportDraft = {
  rowCount: number;
  questions: DiscoveryQuestionDraft[];
  selectedQuestionIds: string[];
  answerMappings: AnswerMappingDraft[];
  source: unknown;
};

type AnalyzeFile = (file: File, channels: CampaignChannelOption[]) => Promise<ConnpassImportDraft>;
type SaveResult = { ok?: boolean; error?: string };

function eventIdFromFileName(name: string): string {
  return name.match(/(?:event_)?(\d{4,})/i)?.[1] ?? "";
}

export function CampaignParticipantImportWizard({
  analyzeFile,
  channels,
  onSaved,
}: {
  analyzeFile: AnalyzeFile;
  channels: CampaignChannelOption[];
  onSaved?: () => void;
}) {
  const fetcher = useFetcher<SaveResult>();
  const [file, setFile] = useState<File | null>(null);
  const [connpassEventId, setConnpassEventId] = useState("");
  const [draft, setDraft] = useState<ConnpassImportDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);

  useEffect(() => {
    if (fetcher.data?.ok) {
      setFile(null);
      setDraft(null);
      setError(null);
      onSaved?.();
    }
  }, [fetcher.data, onSaved]);

  async function runAnalysis(nextFile: File) {
    setAnalyzing(true);
    setError(null);
    setDraft(null);
    setValidationAttempted(false);
    try {
      setDraft(await analyzeFile(nextFile, channels));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not analyze this CSV file.");
    } finally {
      setAnalyzing(false);
    }
  }

  function updateQuestion(questionId: string, selected: boolean) {
    setDraft((current) => {
      if (!current) return current;
      const selectedIds = new Set(current.selectedQuestionIds);
      if (selected) selectedIds.add(questionId);
      else selectedIds.delete(questionId);
      return { ...current, selectedQuestionIds: [...selectedIds] };
    });
  }

  function setChannel(mappingIndex: number, channelId: string) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        answerMappings: current.answerMappings.map((mapping, index) => {
          if (index !== mappingIndex) return mapping;
          return { ...mapping, channelIds: [channelId] };
        }),
      };
    });
  }

  const validation = useMemo(
    () => (draft ? validateParticipantImport(draft, connpassEventId) : null),
    [connpassEventId, draft],
  );

  return (
    <Card className="border-0 bg-transparent shadow-none">
      <Stack>
        <div className="space-y-5">
          {channels.length === 0 ? (
            <Alert title="Add Campaign channels first">
              Create channels such as X, Discord, or connpass on the Channel tab before importing.
            </Alert>
          ) : null}
          {fetcher.data?.ok ? (
            <Alert title="Acquisition data replaced">
              <Icons name="CheckCircle2" aria-hidden="true" className="size-4" />
              Acquisition analytics now uses the latest CSV.
            </Alert>
          ) : null}
          {error || fetcher.data?.error ? (
            <Alert tone="danger" title="Error">
              {error ?? fetcher.data?.error}
            </Alert>
          ) : null}

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
            <FormField id="participants-csv" label={<>connpass CSV</>}>
              <Input
                id="participants-csv"
                type="file"
                accept=".csv,text/csv"
                disabled={channels.length === 0 || analyzing || fetcher.state !== "idle"}
                onChange={(event) => {
                  const nextFile = event.currentTarget.files?.[0] ?? null;
                  setFile(nextFile);
                  if (!nextFile) return;
                  setConnpassEventId(eventIdFromFileName(nextFile.name));
                  void runAnalysis(nextFile);
                }}
              />
            </FormField>
            <div className="flex items-end">
              <Button
                fullWidth
                type="button"
                variant="outline"
                className=""
                disabled={!file || analyzing || fetcher.state !== "idle"}
                onClick={() => file && void runAnalysis(file)}
              >
                <Icons
                  name="RefreshCw"
                  aria-hidden="true"
                  className={cn("size-4", analyzing && "animate-spin")}
                />
                {analyzing ? "Analyzing…" : "Analyze again"}
              </Button>
            </div>
          </div>

          {analyzing ? (
            <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted">
              <Icons name="FileText" aria-hidden="true" className="mr-2 size-5 animate-pulse" />{" "}
              Reading questions and matching Campaign channels…
            </div>
          ) : null}

          {draft ? (
            <fetcher.Form
              method="post"
              className="motion-import-reveal space-y-6"
              onSubmit={(event) => {
                setValidationAttempted(true);
                if (
                  validation &&
                  (validation.errors.length > 0 || validation.unassignedMappings.length > 0)
                ) {
                  event.preventDefault();
                }
              }}
            >
              <input type="hidden" name="intent" value="replaceParticipantAnalytics" />
              <input type="hidden" name="connpassEventId" value={connpassEventId} />
              <input type="hidden" name="draft" value={JSON.stringify(draft)} />

              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface/50 px-4 py-3 text-sm">
                <Icons name="FileText" aria-hidden="true" className="size-4 text-success" />
                <span className="font-medium">{draft.rowCount.toLocaleString()} participants</span>
                <Badge>Rule-based extraction</Badge>
                <span className="text-muted">Review every suggestion before saving.</span>
              </div>

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">1. Discovery questions</legend>
                <p className="text-sm text-muted">
                  Select every question that asks how a participant learned about the event.
                </p>
                <div className="grid gap-2">
                  {draft.questions.map((question) => {
                    const selected = draft.selectedQuestionIds.includes(question.id);
                    return (
                      <Label
                        key={question.id}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm",
                          selected && "border-gdg-blue/60 bg-gdg-blue/5",
                        )}
                      >
                        <Checkbox
                          className="mt-0.5 size-4 accent-primary"
                          checked={selected}
                          onCheckedChange={(checked) =>
                            updateQuestion(question.id, checked === true)
                          }
                        />
                        <span className="min-w-0 flex-1 break-words">{question.label}</span>
                      </Label>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">2. Campaign channel mappings</legend>
                <p className="text-sm text-muted">
                  Confirm one Campaign channel for every option found in the CSV answers.
                </p>
                {draft.selectedQuestionIds.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted">
                    Select at least one discovery question above.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[44rem] text-sm">
                      <thead className="border-b bg-surface/50 text-left text-xs text-muted">
                        <tr>
                          <th className="px-3 py-2 font-medium">Question</th>
                          <th className="px-3 py-2 font-medium">CSV option</th>
                          <th className="px-3 py-2 font-medium">Campaign channel</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {draft.answerMappings.map((mapping, mappingIndex) =>
                          draft.selectedQuestionIds.includes(mapping.questionId) ? (
                            <tr
                              key={`${mapping.questionId}\u0000${mapping.answer}`}
                              className={cn(
                                validationAttempted &&
                                  mapping.channelIds.length === 0 &&
                                  "bg-danger/5",
                              )}
                            >
                              <td className="max-w-52 px-3 py-2 text-xs text-muted">
                                <span className="line-clamp-2" title={mapping.questionLabel}>
                                  {mapping.questionLabel}
                                </span>
                              </td>
                              <td className="max-w-56 px-3 py-2">
                                <span className="line-clamp-2" title={mapping.answer}>
                                  {mapping.answer}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <Select
                                  value={mapping.channelIds[0]}
                                  onValueChange={(channelId) => setChannel(mappingIndex, channelId)}
                                >
                                  <SelectTrigger
                                    className={cn(
                                      "w-full min-w-40",
                                      validationAttempted &&
                                        mapping.channelIds.length === 0 &&
                                        "border-danger",
                                    )}
                                  >
                                    <SelectValue placeholder="Select a channel" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {channels.map((channel) => (
                                      <SelectItem key={channel.id} value={String(channel.id)}>
                                        {channel.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                            </tr>
                          ) : null,
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </fieldset>

              <FormField id="connpass-event-id" label={<>connpass event ID</>}>
                <Input
                  id="connpass-event-id"
                  value={connpassEventId}
                  inputMode="numeric"
                  onChange={(event) => setConnpassEventId(event.target.value)}
                />
              </FormField>

              <div className="flex flex-wrap items-center justify-end gap-3">
                {validationAttempted &&
                validation &&
                (validation.errors.length > 0 || validation.unassignedMappings.length > 0) ? (
                  <Alert
                    tone="danger"
                    className="mr-auto basis-full"
                    title="Acquisition data could not be saved"
                  >
                    {validation.errors.map((message) => (
                      <p key={message}>{message}</p>
                    ))}
                    {validation.unassignedMappings.length > 0 ? (
                      <div className="mt-2">
                        <p>Assign one Campaign channel to these CSV options:</p>
                        <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-5">
                          {validation.unassignedMappings.map((mapping) => (
                            <li key={`${mapping.questionId}\u0000${mapping.answer}`}>
                              {mapping.questionLabel}: {mapping.answer}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </Alert>
                ) : null}
                <Button type="submit" disabled={fetcher.state !== "idle"}>
                  {fetcher.state === "idle" ? "Save and replace acquisition data" : "Saving…"}
                </Button>
              </div>
            </fetcher.Form>
          ) : null}
        </div>
      </Stack>
    </Card>
  );
}
