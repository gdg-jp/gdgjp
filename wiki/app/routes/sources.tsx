import { desc, eq, inArray } from "drizzle-orm";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import ConfirmDialog from "~/components/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { loadGooglePicker } from "~/lib/google-picker.client";
import type { GooglePickerConfig, GooglePickerDocument } from "~/lib/google-picker.client";
import {
  SOURCE_VISIBILITIES,
  isSourceVisibility,
  sourceVisibilityNeedsChapter,
} from "~/lib/sources-shared";
import {
  canAccessSource,
  createSource,
  deleteArchivedSource,
  enqueueSourceRefresh,
  unarchiveSource,
  updateSourceVisibility,
} from "~/lib/sources.server";
import {
  isChatSenderResourceName,
  saveChatSenderName,
} from "../../workers/features/sources/chat-sender-registry";

export const meta: MetaFunction = () => [{ title: "Sources — GDG Japan Wiki" }];

type StagedSource =
  | {
      id: string;
      kind: "google-drive";
      title: string;
      url: string;
    }
  | {
      id: string;
      kind: "google-chat-space";
      title: string;
      url: string;
      externalId: string;
    };

function parseBatchCandidates(raw: FormDataEntryValue | null): StagedSource[] | null {
  if (typeof raw !== "string") return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length === 0 || value.length > 50) return null;
    const ids = new Set<string>();
    const candidates: StagedSource[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Record<string, unknown>;
      if (
        typeof candidate.id !== "string" ||
        !candidate.id ||
        ids.has(candidate.id) ||
        typeof candidate.title !== "string" ||
        typeof candidate.url !== "string"
      ) {
        return null;
      }
      ids.add(candidate.id);
      if (candidate.kind === "google-drive") {
        candidates.push({
          id: candidate.id,
          kind: "google-drive",
          title: candidate.title,
          url: candidate.url,
        });
      } else if (
        candidate.kind === "google-chat-space" &&
        typeof candidate.externalId === "string"
      ) {
        candidates.push({
          id: candidate.id,
          kind: "google-chat-space",
          title: candidate.title,
          url: candidate.url,
          externalId: candidate.externalId,
        });
      } else {
        return null;
      }
    }
    return candidates;
  } catch {
    return null;
  }
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const rows = await db.select().from(schema.sources).orderBy(desc(schema.sources.createdAt)).all();

  const visible = rows.filter((row) => canAccessSource(row, user, identity.chapters));
  const sourceIds = visible.map((row) => row.id);

  const documents =
    sourceIds.length === 0
      ? []
      : await db
          .select({
            id: schema.sourceDocuments.id,
            sourceId: schema.sourceDocuments.sourceId,
            path: schema.sourceDocuments.path,
            title: schema.sourceDocuments.title,
            contentHash: schema.sourceDocuments.contentHash,
            mediaType: schema.sourceDocuments.mediaType,
            capturedAt: schema.sourceDocuments.capturedAt,
            status: schema.sourceDocuments.status,
          })
          .from(schema.sourceDocuments)
          .where(inArray(schema.sourceDocuments.sourceId, sourceIds))
          .orderBy(schema.sourceDocuments.path)
          .all();

  const documentsBySource = new Map<string, typeof documents>();
  for (const doc of documents) {
    const list = documentsBySource.get(doc.sourceId) ?? [];
    list.push(doc);
    documentsBySource.set(doc.sourceId, list);
  }

  // Only chapters the user may actually assign, so the picker cannot offer a scope
  // the action would reject.
  const allChapters = await db
    .select({
      id: schema.chapters.id,
      nameJa: schema.chapters.nameJa,
      nameEn: schema.chapters.nameEn,
    })
    .from(schema.chapters)
    .orderBy(schema.chapters.nameJa)
    .all();
  const assignableChapters = user.isAdmin
    ? allChapters
    : allChapters.filter((chapter) => identity.chapterIds.includes(chapter.id));

  const senderSamples = await db
    .select({
      resourceName: schema.googleChatSenderSamples.resourceName,
      messageText: schema.googleChatSenderSamples.messageText,
      createdAt: schema.googleChatSenderSamples.createdAt,
      sourceId: schema.googleChatSenderSamples.sourceId,
      sourceTitle: schema.sources.title,
    })
    .from(schema.googleChatSenderSamples)
    .innerJoin(schema.sources, eq(schema.googleChatSenderSamples.sourceId, schema.sources.id))
    .orderBy(desc(schema.googleChatSenderSamples.createdAt))
    .all();
  const visibleSamples = senderSamples.filter((sample) => {
    const source = visible.find((item) => item.id === sample.sourceId);
    return source !== undefined;
  });
  // Profiles are one row per sender — select all instead of an unbounded inArray.
  const profiles = await db
    .select({
      resourceName: schema.googleChatSenderProfiles.resourceName,
      displayName: schema.googleChatSenderProfiles.displayName,
    })
    .from(schema.googleChatSenderProfiles)
    .all();

  return {
    allChapters,
    assignableChapters,
    chatSenders: {
      profiles,
      samples: visibleSamples,
    },
    currentUserId: user.id,
    isAdmin: user.isAdmin,
    sources: visible.map((source) => ({
      ...source,
      documents: documentsBySource.get(source.id) ?? [],
    })),
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "create");

  if (intent === "create-batch") {
    const candidates = parseBatchCandidates(form.get("candidates"));
    if (!candidates) return { ok: false as const, error: "invalid_batch" };

    const addedIds: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    for (const candidate of candidates) {
      const result = await createSource(env, {
        ...(candidate.kind === "google-chat-space"
          ? { kind: candidate.kind, externalId: candidate.externalId }
          : { url: candidate.url }),
        title: candidate.title,
        visibility: form.get("visibility"),
        chapter: form.get("chapter"),
        refreshPolicy: form.get("refreshPolicy"),
        user,
        chapters: identity.chapters,
      });

      // `createSource` persists an error source when queue delivery fails. It must leave
      // the staging list so retrying cannot create a duplicate source.
      if (result.ok || result.error === "enqueue_failed") {
        addedIds.push(candidate.id);
      } else {
        failed.push({ id: candidate.id, error: result.error });
      }
    }
    return { ok: true as const, addedIds, failed };
  }

  if (intent === "create") {
    const result = await createSource(env, {
      url: form.get("url"),
      title: form.get("title"),
      visibility: form.get("visibility"),
      chapter: form.get("chapter"),
      refreshPolicy: form.get("refreshPolicy"),
      user,
      chapters: identity.chapters,
    });
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
  }

  if (intent === "create-chat-space") {
    const result = await createSource(env, {
      kind: "google-chat-space",
      externalId: form.get("externalId"),
      title: form.get("title"),
      visibility: form.get("visibility"),
      chapter: form.get("chapter"),
      refreshPolicy: form.get("refreshPolicy"),
      user,
      chapters: identity.chapters,
    });
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
  }

  if (intent === "save-chat-sender") {
    const resourceName = String(form.get("senderId") ?? "").trim();
    const displayName = String(form.get("displayName") ?? "").trim();
    if (!isChatSenderResourceName(resourceName))
      return { ok: false as const, error: "invalid_sender" };
    if (!displayName || displayName.length > 120) {
      return { ok: false as const, error: "sender_name_required" };
    }
    const db = getDb(env);
    const known = await db
      .select({ source: schema.sources })
      .from(schema.googleChatSenderSamples)
      .innerJoin(schema.sources, eq(schema.googleChatSenderSamples.sourceId, schema.sources.id))
      .where(eq(schema.googleChatSenderSamples.resourceName, resourceName))
      .all();
    if (!known.some(({ source }) => canAccessSource(source, user, identity.chapters))) {
      return { ok: false as const, error: "invalid_sender" };
    }
    await saveChatSenderName(env, resourceName, displayName);
    return { ok: true as const, senderSaved: true };
  }

  if (intent === "update-visibility") {
    const sourceId = String(form.get("sourceId") ?? "");
    const result = await updateSourceVisibility(env, sourceId, {
      visibility: form.get("visibility"),
      chapter: form.get("chapter"),
      user,
      chapters: identity.chapters,
    });
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
  }

  if (
    intent === "refresh" ||
    intent === "archive" ||
    intent === "unarchive" ||
    intent === "delete"
  ) {
    const sourceId = String(form.get("sourceId") ?? "");
    const db = getDb(env);
    const source = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, sourceId))
      .get();
    if (!source || !canAccessSource(source, user, identity.chapters)) {
      return { ok: false as const, error: "not_found" };
    }

    if (intent === "archive") {
      await db
        .update(schema.sources)
        .set({ status: "archived", fetchAttemptId: null, updatedAt: new Date() })
        .where(eq(schema.sources.id, sourceId));
      return { ok: true as const };
    }

    if (intent === "unarchive") {
      const result = await unarchiveSource(env, sourceId);
      return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
    }

    if (intent === "delete") {
      const result = await deleteArchivedSource(env, sourceId);
      return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
    }

    if (source.status === "archived") {
      return { ok: false as const, error: "archived" };
    }
    const result = await enqueueSourceRefresh(env, sourceId);
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
  }

  return { ok: false as const, error: "unknown_intent" };
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "ready":
      return "bg-feedback-success-surface text-feedback-success-foreground";
    case "pending":
    case "fetching":
      return "bg-feedback-warning-surface text-feedback-warning-foreground";
    case "error":
      return "bg-feedback-danger-surface text-feedback-danger-foreground";
    case "archived":
      return "bg-surface-hover text-content-secondary";
    default:
      return "bg-surface-hover text-content-secondary";
  }
}

const SOURCE_MIME_TYPES = [
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.presentation",
  "application/vnd.google-apps.spreadsheet",
].join(",");

function sourceUrlFromGoogleDocument(document: GooglePickerDocument): string | null {
  switch (document.mimeType) {
    case "application/vnd.google-apps.document":
      return `https://docs.google.com/document/d/${document.id}/edit`;
    case "application/vnd.google-apps.presentation":
      return `https://docs.google.com/presentation/d/${document.id}/edit`;
    case "application/vnd.google-apps.spreadsheet":
      return `https://docs.google.com/spreadsheets/d/${document.id}/edit`;
    default:
      return null;
  }
}

export default function SourcesPage() {
  const { allChapters, assignableChapters, chatSenders, currentUserId, isAdmin, sources } =
    useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation();
  const revalidator = useRevalidator();
  const batchFetcher = useFetcher<typeof action>();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [candidates, setCandidates] = useState<StagedSource[]>([]);
  const [candidateErrors, setCandidateErrors] = useState<Record<string, string>>({});
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [needsDriveConnection, setNeedsDriveConnection] = useState(false);
  const [chatSpaces, setChatSpaces] = useState<
    Array<{ name: string; displayName: string; spaceType: string | null }>
  >([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [needsChatReauth, setNeedsChatReauth] = useState(false);
  const [senderDialogOpen, setSenderDialogOpen] = useState(false);
  const chatSpacesLoadStarted = useRef(false);
  const [visibility, setVisibility] = useState("");
  const [chapter, setChapter] = useState(
    assignableChapters.length === 1 ? assignableChapters[0].id : "",
  );
  const submitting = batchFetcher.state !== "idle";
  const needsChapter = isSourceVisibility(visibility) && sourceVisibilityNeedsChapter(visibility);
  const canSubmitImport = Boolean(
    visibility && (!needsChapter || chapter) && candidates.length > 0,
  );

  const pendingCount = useMemo(
    () => sources.filter((s) => s.status === "pending" || s.status === "fetching").length,
    [sources],
  );

  // Soft-poll while fetches are in flight.
  useEffect(() => {
    if (pendingCount === 0) return;
    const timer = setInterval(() => revalidator.revalidate(), 3000);
    return () => clearInterval(timer);
  }, [pendingCount, revalidator]);

  useEffect(() => {
    if (chatSpacesLoadStarted.current) return;
    chatSpacesLoadStarted.current = true;
    void loadChatSpaces();
  }, []);

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

  function addCandidates(next: StagedSource[]) {
    setCandidates((current) => {
      const byId = new Map(current.map((candidate) => [candidate.id, candidate]));
      for (const candidate of next) byId.set(candidate.id, candidate);
      return [...byId.values()];
    });
    setCandidateErrors((current) => {
      const nextErrors = { ...current };
      for (const candidate of next) delete nextErrors[candidate.id];
      return nextErrors;
    });
  }

  function removeCandidate(id: string) {
    setCandidates((current) => current.filter((candidate) => candidate.id !== id));
    setCandidateErrors((current) => {
      const nextErrors = { ...current };
      delete nextErrors[id];
      return nextErrors;
    });
  }

  async function chooseGoogleDriveSource() {
    setPickerError(null);
    setNeedsDriveConnection(false);
    setPickerLoading(true);
    try {
      const response = await fetch("/api/google-documents/picker-token", {
        credentials: "same-origin",
      });
      const config = (await response.json().catch(() => null)) as GooglePickerConfig | null;
      if (!response.ok || !config || !("accessToken" in config)) {
        if (response.status === 401) {
          setNeedsDriveConnection(true);
          return;
        }
        throw new Error("Unable to prepare Google Drive");
      }

      await loadGooglePicker();
      const picker = window.google?.picker;
      if (!picker) throw new Error("Google Picker unavailable");
      const view = new picker.DocsView(picker.ViewId.DOCS);
      view.setMimeTypes(SOURCE_MIME_TYPES);
      view.setSelectFolderEnabled(false);
      new picker.PickerBuilder()
        .setDeveloperKey(config.apiKey)
        .setAppId(config.appId)
        .setOAuthToken(config.accessToken)
        .addView(view)
        .enableFeature(picker.Feature.MULTISELECT_ENABLED)
        .setCallback((data) => {
          if (data.action === picker.Action.PICKED) {
            const selected = (data.docs ?? []).flatMap((document) => {
              const url = sourceUrlFromGoogleDocument(document);
              return url
                ? [
                    {
                      id: `drive:${document.id}`,
                      kind: "google-drive" as const,
                      title: document.name,
                      url,
                    },
                  ]
                : [];
            });
            if (selected.length === 0) {
              setPickerError(t("sources.error_unsupported_document"));
            } else {
              addCandidates(selected);
            }
          }
          setPickerLoading(false);
        })
        .build()
        .setVisible(true);
    } catch {
      setPickerError(t("sources.error_picker"));
      setPickerLoading(false);
    }
  }

  async function loadChatSpaces() {
    setChatError(null);
    setNeedsDriveConnection(false);
    setNeedsChatReauth(false);
    setChatLoading(true);
    try {
      const response = await fetch("/api/google-chat/spaces", { credentials: "same-origin" });
      const body = (await response.json().catch(() => null)) as {
        spaces?: Array<{ name: string; displayName: string; spaceType: string | null }>;
        error?: string;
        reauthorize?: boolean;
      } | null;
      if (response.status === 401) {
        setNeedsDriveConnection(true);
        return;
      }
      if (response.status === 403 && body?.reauthorize) {
        setNeedsChatReauth(true);
        return;
      }
      if (!response.ok || !body?.spaces) {
        throw new Error(body?.error ?? "spaces_list_failed");
      }
      setChatSpaces(body.spaces);
    } catch {
      setChatError(t("sources.error_chat_spaces"));
    } finally {
      setChatLoading(false);
    }
  }

  function connectGoogleDrive() {
    window.location.assign("/api/google-drive/auth?returnTo=%2Fsources");
  }

  function addChatSpace(space: (typeof chatSpaces)[number]) {
    addCandidates([
      {
        id: `chat:${space.name}`,
        kind: "google-chat-space",
        title: space.displayName,
        url: `https://mail.google.com/chat/u/0/#chat/space/${space.name.slice("spaces/".length)}`,
        externalId: space.name,
      },
    ]);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-content-primary">{t("sources.title")}</h1>
          <p className="mt-1 text-sm text-content-secondary">{t("sources.subtitle")}</p>
        </div>
        <button
          type="button"
          disabled={chatSenders.samples.length === 0}
          onClick={() => setSenderDialogOpen(true)}
          className="shrink-0 rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-content-secondary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t("sources.configure_senders")}
        </button>
      </header>

      <section className="mb-8 rounded-lg border border-border-default bg-surface-raised p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={chooseGoogleDriveSource}
              disabled={pickerLoading}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-content-secondary hover:bg-surface-hover disabled:opacity-60"
            >
              {pickerLoading ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <FileText className="size-4" />
              )}
              {t("sources.choose_google_drive")}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-content-secondary hover:bg-surface-hover"
                >
                  {chatLoading ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <MessageSquare className="size-4" />
                  )}
                  {t("sources.add_chat_space")}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-56">
                {chatLoading ? (
                  <DropdownMenuItem disabled>
                    <LoaderCircle className="size-4 animate-spin" />
                    {t("sources.chat_space_placeholder")}
                  </DropdownMenuItem>
                ) : (
                  chatSpaces.map((space) => (
                    <DropdownMenuItem key={space.name} onSelect={() => addChatSpace(space)}>
                      {space.displayName}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row">
            <VisibilitySelect t={t} value={visibility} onValueChange={setVisibility} />
            {needsChapter ? (
              <ChapterSelect
                chapters={assignableChapters}
                language={i18n.language}
                t={t}
                value={chapter}
                onValueChange={setChapter}
              />
            ) : null}
            <button
              type="button"
              disabled={submitting || !canSubmitImport}
              onClick={() =>
                batchFetcher.submit(
                  {
                    intent: "create-batch",
                    visibility,
                    chapter: needsChapter ? chapter : "",
                    candidates: JSON.stringify(candidates),
                  },
                  { method: "post" },
                )
              }
              className="inline-flex items-center justify-center gap-2 rounded-md bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-60"
            >
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t("sources.add")}
            </button>
          </div>
        </div>
        <div>
          {candidates.length > 0 ? (
            <ul className="mt-4 divide-y divide-border-subtle rounded-md border border-border-default">
              {candidates.map((candidate) => (
                <li key={candidate.id} className="flex items-start gap-3 px-3 py-2">
                  {candidate.kind === "google-drive" ? (
                    <FileText className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <MessageSquare className="mt-0.5 size-4 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-content-primary">
                      {candidate.title}
                    </p>
                    <a
                      href={candidate.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-xs text-action-primary hover:underline"
                    >
                      {candidate.url}
                    </a>
                    {candidateErrors[candidate.id] ? (
                      <p className="mt-1 text-xs text-feedback-danger-foreground">
                        {t(`sources.error_${candidateErrors[candidate.id]}`, {
                          defaultValue: t("sources.error_generic"),
                        })}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeCandidate(candidate.id)}
                    className="rounded p-1 text-content-tertiary hover:bg-surface-hover"
                    aria-label={t("sources.remove_candidate", { title: candidate.title })}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {needsDriveConnection ? (
            <div className="mt-3 flex items-center gap-3 rounded-md border border-border-default bg-surface-sunken p-3 text-sm">
              <span>{t("sources.connect_hint")}</span>
              <button
                type="button"
                onClick={connectGoogleDrive}
                className="font-medium text-action-primary hover:text-action-primary-hover"
              >
                {t("sources.connect_google_drive")}
              </button>
            </div>
          ) : null}
          {pickerError ? (
            <p className="mt-2 text-sm text-feedback-danger-foreground">{pickerError}</p>
          ) : null}
          {needsChatReauth ? (
            <div className="mt-3 flex items-center gap-3 rounded-md border border-feedback-warning-border bg-feedback-warning-surface p-3 text-sm text-feedback-warning-foreground">
              <span>{t("sources.chat_reauth_hint")}</span>
              <button
                type="button"
                onClick={connectGoogleDrive}
                className="font-medium text-action-primary hover:text-action-primary-hover"
              >
                {t("sources.connect_google_drive")}
              </button>
            </div>
          ) : null}
          {chatError ? (
            <p className="mt-2 text-sm text-feedback-danger-foreground">{chatError}</p>
          ) : null}
          {batchFetcher.data?.ok &&
          "failed" in batchFetcher.data &&
          batchFetcher.data.failed?.length ? (
            <p className="mt-2 text-sm text-feedback-danger-foreground">
              {t("sources.batch_partial_failure")}
            </p>
          ) : null}
          {batchFetcher.data && !batchFetcher.data.ok ? (
            <p className="mt-2 text-sm text-feedback-danger-foreground">
              {t(`sources.error_${batchFetcher.data.error}`, {
                defaultValue: t("sources.error_generic"),
              })}
            </p>
          ) : null}
        </div>
      </section>

      {sources.length === 0 ? (
        <p className="text-sm text-content-tertiary">{t("sources.empty")}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border-default bg-surface-raised">
          <table className="w-full table-fixed divide-y divide-border-default text-sm">
            <colgroup>
              <col className="w-10" />
              <col />
              <col className="w-28" />
              <col className="w-32" />
              <col className="w-24" />
              <col className="w-24" />
              <col className="w-36" />
              <col className="w-40" />
            </colgroup>
            <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wide text-content-tertiary">
              <tr>
                <th className="px-3 py-2" />
                <th className="px-3 py-2">{t("sources.col_title")}</th>
                <th className="px-3 py-2">{t("sources.col_kind")}</th>
                <th className="px-3 py-2">{t("sources.col_visibility")}</th>
                <th className="px-3 py-2">{t("sources.col_status")}</th>
                <th className="px-3 py-2">{t("sources.col_documents")}</th>
                <th className="px-3 py-2">{t("sources.col_fetched")}</th>
                <th className="px-3 py-2">{t("sources.col_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {sources.map((source) => {
                const open = expanded[source.id] ?? false;
                return (
                  <SourceRows
                    key={source.id}
                    source={source}
                    open={open}
                    onToggle={() => setExpanded((prev) => ({ ...prev, [source.id]: !open }))}
                    assignableChapters={assignableChapters}
                    allChapters={allChapters}
                    canEditVisibility={source.addedBy === currentUserId || isAdmin}
                    language={i18n.language}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ChatSenderDialog
        open={senderDialogOpen}
        onOpenChange={setSenderDialogOpen}
        profiles={chatSenders.profiles}
        samples={chatSenders.samples}
      />
    </div>
  );
}

function ChatSenderDialog({
  open,
  onOpenChange,
  profiles,
  samples,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: Array<{ resourceName: string; displayName: string }>;
  samples: Array<{
    resourceName: string;
    messageText: string;
    sourceId: string;
    sourceTitle: string;
  }>;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.resourceName, profile])),
    [profiles],
  );
  const senderIds = useMemo(() => {
    const ids = [...new Set(samples.map((sample) => sample.resourceName))];
    return ids.sort((left, right) => {
      const leftLabel = profileById.get(left)?.displayName
        ? `${profileById.get(left)?.displayName} (${left})`
        : left;
      const rightLabel = profileById.get(right)?.displayName
        ? `${profileById.get(right)?.displayName} (${right})`
        : right;
      const leftMapped = profileById.has(left);
      const rightMapped = profileById.has(right);
      return leftMapped === rightMapped ? leftLabel.localeCompare(rightLabel) : leftMapped ? 1 : -1;
    });
  }, [profileById, samples]);
  const [senderId, setSenderId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const selectedSamples = samples.filter((sample) => sample.resourceName === senderId).slice(0, 10);
  const saving = fetcher.state !== "idle";

  useEffect(() => {
    if (!open) return;
    const first = senderIds[0] ?? "";
    setSenderId(first);
    setDisplayName(profileById.get(first)?.displayName ?? "");
    setExpanded({});
  }, [open, profileById, senderIds]);

  function selectSender(nextId: string) {
    setSenderId(nextId);
    setDisplayName(profileById.get(nextId)?.displayName ?? "");
    setExpanded({});
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-surface-raised sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("sources.sender_dialog_title")}</DialogTitle>
          <DialogDescription>{t("sources.sender_dialog_description")}</DialogDescription>
        </DialogHeader>
        <fetcher.Form method="post" className="space-y-4 px-5 pb-5">
          <input type="hidden" name="intent" value="save-chat-sender" />
          <input type="hidden" name="senderId" value={senderId} />
          <div className="block text-sm font-medium text-content-secondary">
            <p>{t("sources.sender_id_label")}</p>
            <Select value={senderId} onValueChange={selectSender}>
              <SelectTrigger className="mt-1 w-full bg-surface-raised">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {senderIds.map((id) => {
                  const profile = profileById.get(id);
                  return (
                    <SelectItem key={id} value={id}>
                      {profile ? `${profile.displayName} (${id})` : id}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <label className="block text-sm font-medium text-content-secondary">
            {t("sources.sender_name_label")}
            <input
              name="displayName"
              required
              maxLength={120}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="mt-1 block w-full rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-sm"
            />
          </label>
          <section>
            <h3 className="text-sm font-medium text-content-secondary">
              {t("sources.sender_samples")}
            </h3>
            <ul className="mt-2 space-y-2">
              {selectedSamples.map((sample, index) => {
                const key = `${sample.sourceId}:${index}`;
                const isExpanded = expanded[key] ?? false;
                const preview =
                  sample.messageText.length > 160
                    ? `${sample.messageText.slice(0, 160)}…`
                    : sample.messageText;
                return (
                  <li key={key} className="rounded-md border border-border-default p-3 text-sm">
                    <p className="font-medium text-content-primary">{sample.sourceTitle}</p>
                    <p className="mt-1 whitespace-pre-wrap text-content-secondary">
                      {isExpanded
                        ? sample.messageText
                        : preview || t("sources.sender_empty_message")}
                    </p>
                    {sample.messageText.length > 160 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((current) => ({ ...current, [key]: !isExpanded }))
                        }
                        className="mt-2 text-xs font-medium text-action-primary hover:underline"
                      >
                        {t(isExpanded ? "sources.sender_collapse" : "sources.sender_expand")}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
          {fetcher.data && !fetcher.data.ok ? (
            <p className="text-sm text-feedback-danger-foreground">
              {t(`sources.error_${fetcher.data.error}`, {
                defaultValue: t("sources.error_generic"),
              })}
            </p>
          ) : null}
          {fetcher.data?.ok && fetcher.data.senderSaved ? (
            <p className="text-sm text-feedback-success-foreground">{t("sources.sender_saved")}</p>
          ) : null}
          <DialogFooter className="px-0 py-0">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-border-strong px-4 py-2 text-sm hover:bg-surface-hover"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={saving || !senderId || !displayName.trim()}
              className="rounded-md bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-60"
            >
              {saving ? t("sources.sender_saving") : t("sources.sender_save")}
            </button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

function VisibilitySelect({
  t,
  value,
  onValueChange,
}: {
  t: (key: string) => string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        className="w-full bg-surface-raised sm:w-56"
        aria-label={t("sources.visibility_label")}
      >
        <SelectValue placeholder={t("sources.visibility_placeholder")} />
      </SelectTrigger>
      <SelectContent>
        {SOURCE_VISIBILITIES.map((option) => (
          <SelectItem key={option} value={option}>
            {t(`sources.visibility.${option}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ChapterSelect({
  chapters,
  language,
  t,
  value,
  onValueChange,
}: {
  chapters: Array<{ id: string; nameJa: string; nameEn: string }>;
  language: string;
  t: (key: string) => string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        className="w-full bg-surface-raised sm:w-56"
        aria-label={t("sources.chapter_label")}
      >
        <SelectValue placeholder={t("sources.chapter_placeholder")} />
      </SelectTrigger>
      <SelectContent>
        {chapters.map((chapter) => (
          <SelectItem key={chapter.id} value={chapter.id}>
            {language.startsWith("en") ? chapter.nameEn : chapter.nameJa}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SourceRows({
  source,
  open,
  onToggle,
  assignableChapters,
  allChapters,
  canEditVisibility,
  language,
}: {
  source: {
    id: string;
    title: string;
    url: string;
    kind: string;
    status: string;
    visibility: string;
    chapterId: string | null;
    errorMessage: string | null;
    lastFetchedAt: Date | string | null;
    documents: Array<{
      id: string;
      path: string;
      title: string;
      contentHash: string;
      mediaType: string;
      capturedAt: Date | string;
      status: string;
    }>;
  };
  open: boolean;
  onToggle: () => void;
  assignableChapters: Array<{ id: string; nameJa: string; nameEn: string }>;
  allChapters: Array<{ id: string; nameJa: string; nameEn: string }>;
  canEditVisibility: boolean;
  language: string;
}) {
  const { t } = useTranslation();
  const refreshFetcher = useFetcher();
  const archiveFetcher = useFetcher();
  const unarchiveFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const visibilityFetcher = useFetcher();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editVisibility, setEditVisibility] = useState(source.visibility);
  const [editChapter, setEditChapter] = useState(source.chapterId ?? "");
  const editNeedsChapter =
    isSourceVisibility(editVisibility) && sourceVisibilityNeedsChapter(editVisibility);
  const busy =
    refreshFetcher.state !== "idle" ||
    archiveFetcher.state !== "idle" ||
    unarchiveFetcher.state !== "idle" ||
    deleteFetcher.state !== "idle" ||
    visibilityFetcher.state !== "idle";

  const fetchedLabel = source.lastFetchedAt ? new Date(source.lastFetchedAt).toLocaleString() : "—";
  const visibilityLabel = isSourceVisibility(source.visibility)
    ? t(`sources.visibility.${source.visibility}`)
    : source.visibility;
  const chapterName = source.chapterId
    ? allChapters.find((chapter) => chapter.id === source.chapterId)
    : null;
  const visibilityDetail =
    chapterName &&
    isSourceVisibility(source.visibility) &&
    sourceVisibilityNeedsChapter(source.visibility)
      ? ` (${language.startsWith("en") ? chapterName.nameEn : chapterName.nameJa})`
      : "";

  return (
    <>
      <tr className="align-top">
        <td className="px-3 py-3">
          <button
            type="button"
            onClick={onToggle}
            className="rounded p-1 text-content-tertiary hover:bg-surface-hover"
            aria-expanded={open}
            aria-label={t("sources.toggle_documents")}
          >
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </td>
        <td className="min-w-0 px-3 py-3">
          <div className="truncate font-medium text-content-primary" title={source.title}>
            {source.title}
          </div>
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 block truncate text-xs text-action-primary hover:underline"
            title={source.url}
          >
            {source.url}
          </a>
          {source.errorMessage ? (
            <p className="mt-1 text-xs text-feedback-danger-foreground">{source.errorMessage}</p>
          ) : null}
        </td>
        <td className="px-3 py-3 text-content-secondary">
          {t(`sources.kind.${source.kind}`, source.kind)}
        </td>
        <td className="px-3 py-3">
          <span className="inline-flex rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-content-secondary">
            {visibilityLabel}
            {visibilityDetail}
          </span>
          {canEditVisibility ? (
            <visibilityFetcher.Form method="post" className="mt-2 space-y-2">
              <input type="hidden" name="intent" value="update-visibility" />
              <input type="hidden" name="sourceId" value={source.id} />
              <VisibilitySelect t={t} value={editVisibility} onValueChange={setEditVisibility} />
              {editNeedsChapter ? (
                <ChapterSelect
                  chapters={assignableChapters}
                  language={language}
                  t={t}
                  value={editChapter}
                  onValueChange={setEditChapter}
                />
              ) : null}
              <button
                type="submit"
                disabled={
                  busy || !isSourceVisibility(editVisibility) || (editNeedsChapter && !editChapter)
                }
                className="rounded border border-border-strong px-2 py-1 text-xs hover:bg-surface-hover disabled:opacity-50"
              >
                {t("sources.visibility_save")}
              </button>
              <input type="hidden" name="visibility" value={editVisibility} />
              <input type="hidden" name="chapter" value={editNeedsChapter ? editChapter : ""} />
            </visibilityFetcher.Form>
          ) : null}
        </td>
        <td className="px-3 py-3">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(source.status)}`}
          >
            {t(`sources.status.${source.status}`, source.status)}
          </span>
        </td>
        <td className="px-3 py-3 text-content-secondary">{source.documents.length}</td>
        <td className="px-3 py-3 text-content-secondary">{fetchedLabel}</td>
        <td className="px-3 py-3">
          <div className="flex flex-wrap gap-2">
            {source.status === "archived" ? (
              <>
                <unarchiveFetcher.Form method="post">
                  <input type="hidden" name="intent" value="unarchive" />
                  <input type="hidden" name="sourceId" value={source.id} />
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded border border-border-strong px-2 py-1 text-xs hover:bg-surface-hover disabled:opacity-50"
                  >
                    <RefreshCw size={12} />
                    {t("sources.unarchive")}
                  </button>
                </unarchiveFetcher.Form>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDeleteDialogOpen(true)}
                  className="inline-flex items-center gap-1 rounded border border-feedback-danger-border px-2 py-1 text-xs text-feedback-danger-foreground hover:bg-feedback-danger-surface disabled:opacity-50"
                >
                  <Trash2 size={12} />
                  {t("sources.delete")}
                </button>
              </>
            ) : (
              <>
                <refreshFetcher.Form method="post">
                  <input type="hidden" name="intent" value="refresh" />
                  <input type="hidden" name="sourceId" value={source.id} />
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded border border-border-strong px-2 py-1 text-xs hover:bg-surface-hover disabled:opacity-50"
                  >
                    <RefreshCw size={12} />
                    {t("sources.refresh")}
                  </button>
                </refreshFetcher.Form>
                <archiveFetcher.Form method="post">
                  <input type="hidden" name="intent" value="archive" />
                  <input type="hidden" name="sourceId" value={source.id} />
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded border border-border-strong px-2 py-1 text-xs hover:bg-surface-hover disabled:opacity-50"
                  >
                    {t("sources.archive")}
                  </button>
                </archiveFetcher.Form>
              </>
            )}
          </div>
          {unarchiveFetcher.data && !unarchiveFetcher.data.ok ? (
            <p className="mt-1 text-xs text-feedback-danger-foreground">
              {t(`sources.error_${unarchiveFetcher.data.error}`, {
                defaultValue: t("sources.error_generic"),
              })}
            </p>
          ) : null}
          {deleteFetcher.data && !deleteFetcher.data.ok ? (
            <p className="mt-1 text-xs text-feedback-danger-foreground">
              {t(`sources.error_${deleteFetcher.data.error}`, {
                defaultValue: t("sources.error_generic"),
              })}
            </p>
          ) : null}
        </td>
      </tr>
      <ConfirmDialog
        open={deleteDialogOpen}
        title={t("sources.delete")}
        message={t("sources.delete_confirm", { title: source.title })}
        confirmLabel={t("sources.delete")}
        cancelLabel={t("cancel")}
        destructive
        onConfirm={() => {
          deleteFetcher.submit({ intent: "delete", sourceId: source.id }, { method: "post" });
          setDeleteDialogOpen(false);
        }}
        onCancel={() => setDeleteDialogOpen(false)}
      />
      {open ? (
        <tr>
          <td colSpan={8} className="bg-surface-sunken px-6 py-3">
            {source.documents.length === 0 ? (
              <p className="text-xs text-content-tertiary">{t("sources.no_documents")}</p>
            ) : (
              <ul className="space-y-1">
                {source.documents.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-content-secondary"
                  >
                    <span className="font-medium">{doc.title}</span>
                    <span className="text-content-tertiary">{doc.path}</span>
                    <span className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-content-tertiary">
                      {doc.mediaType}
                    </span>
                    <span className="font-mono text-content-disabled">
                      {doc.contentHash.slice(0, 12)}…
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
