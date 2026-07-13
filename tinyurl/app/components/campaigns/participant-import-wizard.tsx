import { CheckCircle2, FileSearch, FileSpreadsheet, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { validateParticipantImport } from "~/lib/campaign-participant-import-validation";
import { cn } from "~/lib/utils";

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
      <CardContent className="space-y-5">
        {channels.length === 0 ? (
          <Alert>
            <AlertTitle>Add Campaign channels first</AlertTitle>
            <AlertDescription>
              Create channels such as X, Discord, or connpass on the Channel tab before importing.
            </AlertDescription>
          </Alert>
        ) : null}
        {fetcher.data?.ok ? (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertTitle>Registration data replaced</AlertTitle>
            <AlertDescription>Conversion attribution now uses the latest CSV.</AlertDescription>
          </Alert>
        ) : null}
        {error || fetcher.data?.error ? (
          <Alert variant="destructive">
            <AlertDescription>{error ?? fetcher.data?.error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="space-y-2">
            <Label htmlFor="participants-csv">connpass CSV</Label>
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
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={!file || analyzing || fetcher.state !== "idle"}
              onClick={() => file && void runAnalysis(file)}
            >
              <RefreshCw className={cn("size-4", analyzing && "animate-spin")} />
              {analyzing ? "Analyzing…" : "Analyze again"}
            </Button>
          </div>
        </div>

        {analyzing ? (
          <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            <FileSearch className="mr-2 size-5 animate-pulse" /> Reading questions and matching
            Campaign channels…
          </div>
        ) : null}

        {draft ? (
          <fetcher.Form
            method="post"
            className="space-y-6"
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

            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-4 py-3 text-sm">
              <FileSpreadsheet className="size-4 text-gdg-green" />
              <span className="font-medium">{draft.rowCount.toLocaleString()} registrations</span>
              <Badge variant="outline">Rule-based extraction</Badge>
              <span className="text-muted-foreground">Review every suggestion before saving.</span>
            </div>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">1. Discovery questions</legend>
              <p className="text-sm text-muted-foreground">
                Select every question that asks how a participant learned about the event.
              </p>
              <div className="grid gap-2">
                {draft.questions.map((question) => {
                  const selected = draft.selectedQuestionIds.includes(question.id);
                  return (
                    <label
                      key={question.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm",
                        selected && "border-gdg-blue/60 bg-gdg-blue/5",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-primary"
                        checked={selected}
                        onChange={(event) => updateQuestion(question.id, event.target.checked)}
                      />
                      <span className="min-w-0 flex-1 break-words">{question.label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">2. Campaign channel mappings</legend>
              <p className="text-sm text-muted-foreground">
                Confirm one Campaign channel for every option found in the CSV answers.
              </p>
              {draft.selectedQuestionIds.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Select at least one discovery question above.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[44rem] text-sm">
                    <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
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
                                "bg-destructive/5",
                            )}
                          >
                            <td className="max-w-52 px-3 py-2 text-xs text-muted-foreground">
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
                                  size="sm"
                                  className={cn(
                                    "w-full min-w-40",
                                    validationAttempted &&
                                      mapping.channelIds.length === 0 &&
                                      "border-destructive",
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

            <div className="max-w-xs space-y-2 border-t pt-5">
              <Label htmlFor="connpass-event-id">connpass event ID</Label>
              <Input
                id="connpass-event-id"
                value={connpassEventId}
                inputMode="numeric"
                onChange={(event) => setConnpassEventId(event.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              {validationAttempted &&
              validation &&
              (validation.errors.length > 0 || validation.unassignedMappings.length > 0) ? (
                <Alert variant="destructive" className="mr-auto basis-full">
                  <AlertTitle>Conversion data could not be saved</AlertTitle>
                  <AlertDescription>
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
                  </AlertDescription>
                </Alert>
              ) : null}
              <Button type="submit" disabled={fetcher.state !== "idle"}>
                {fetcher.state === "idle" ? "Save and replace conversion data" : "Saving…"}
              </Button>
            </div>
          </fetcher.Form>
        ) : null}
      </CardContent>
    </Card>
  );
}
