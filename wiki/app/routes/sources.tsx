import { desc, eq, inArray } from "drizzle-orm";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { loadGooglePicker } from "~/lib/google-picker.client";
import type { GooglePickerConfig, GooglePickerDocument } from "~/lib/google-picker.client";
import { ALL_CHAPTERS } from "~/lib/sources-shared";
import { canAccessSource, createSource, enqueueSourceRefresh } from "~/lib/sources.server";

export const meta: MetaFunction = () => [{ title: "Sources — GDG Japan Wiki" }];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const rows = await db.select().from(schema.sources).orderBy(desc(schema.sources.createdAt)).all();

  const visible = rows.filter((row) => canAccessSource(row, user, identity.chapterIds));
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

  return {
    assignableChapters,
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

  if (intent === "create") {
    const result = await createSource(env, {
      url: form.get("url"),
      chapter: form.get("chapter"),
      refreshPolicy: form.get("refreshPolicy"),
      user,
      chapterIds: identity.chapterIds,
    });
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
  }

  if (intent === "create-chat-space") {
    const result = await createSource(env, {
      kind: "google-chat-space",
      externalId: form.get("externalId"),
      title: form.get("title"),
      chapter: form.get("chapter"),
      refreshPolicy: form.get("refreshPolicy"),
      user,
      chapterIds: identity.chapterIds,
    });
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
  }

  if (intent === "refresh" || intent === "archive") {
    const sourceId = String(form.get("sourceId") ?? "");
    const db = getDb(env);
    const source = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, sourceId))
      .get();
    if (!source || !canAccessSource(source, user, identity.chapterIds)) {
      return { ok: false as const, error: "not_found" };
    }

    if (intent === "archive") {
      await db
        .update(schema.sources)
        .set({ status: "archived", fetchAttemptId: null, updatedAt: new Date() })
        .where(eq(schema.sources.id, sourceId));
      return { ok: true as const };
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
      return "bg-emerald-50 text-emerald-700";
    case "pending":
    case "fetching":
      return "bg-amber-50 text-amber-700";
    case "error":
      return "bg-red-50 text-red-700";
    case "archived":
      return "bg-gray-100 text-gray-600";
    default:
      return "bg-gray-100 text-gray-700";
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
  const { assignableChapters, sources } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedDocument, setSelectedDocument] = useState<GooglePickerDocument | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [needsDriveConnection, setNeedsDriveConnection] = useState(false);
  const [chatSpaces, setChatSpaces] = useState<
    Array<{ name: string; displayName: string; spaceType: string | null }>
  >([]);
  const [selectedSpaceName, setSelectedSpaceName] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [needsChatReauth, setNeedsChatReauth] = useState(false);
  const submitting = navigation.state !== "idle";

  const pendingCount = useMemo(
    () => sources.filter((s) => s.status === "pending" || s.status === "fetching").length,
    [sources],
  );

  const selectedSpace = chatSpaces.find((space) => space.name === selectedSpaceName) ?? null;

  // Soft-poll while fetches are in flight.
  useEffect(() => {
    if (pendingCount === 0) return;
    const timer = setInterval(() => revalidator.revalidate(), 3000);
    return () => clearInterval(timer);
  }, [pendingCount, revalidator]);

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
        .setCallback((data) => {
          if (data.action === picker.Action.PICKED) {
            const document = data.docs?.[0];
            if (!document || !sourceUrlFromGoogleDocument(document)) {
              setPickerError(t("sources.error_unsupported_document"));
            } else {
              setSelectedDocument(document);
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
      if (body.spaces.length === 1) setSelectedSpaceName(body.spaces[0].name);
    } catch {
      setChatError(t("sources.error_chat_spaces"));
    } finally {
      setChatLoading(false);
    }
  }

  function connectGoogleDrive() {
    window.location.assign("/api/google-drive/auth?returnTo=%2Fsources");
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">{t("sources.title")}</h1>
        <p className="mt-1 text-sm text-gray-600">{t("sources.subtitle")}</p>
      </header>

      <Form method="post" className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
        <input type="hidden" name="intent" value="create" />
        <input
          type="hidden"
          name="url"
          value={selectedDocument ? (sourceUrlFromGoogleDocument(selectedDocument) ?? "") : ""}
        />
        <p className="text-sm font-medium text-gray-700">{t("sources.document_label")}</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={chooseGoogleDriveSource}
            disabled={pickerLoading}
            className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {pickerLoading ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <FileText className="size-4" />
            )}
            {selectedDocument ? selectedDocument.name : t("sources.choose_google_drive")}
          </button>
          <ChapterSelect chapters={assignableChapters} language={i18n.language} t={t} />
          <button
            type="submit"
            disabled={submitting || !selectedDocument}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {t("sources.add")}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">{t("sources.document_hint")}</p>
        <p className="mt-1 text-xs text-gray-500">{t("sources.chapter_hint")}</p>
        {needsDriveConnection ? (
          <div className="mt-3 flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
            <span>{t("sources.connect_hint")}</span>
            <button
              type="button"
              onClick={connectGoogleDrive}
              className="font-medium text-blue-600 hover:text-blue-700"
            >
              {t("sources.connect_google_drive")}
            </button>
          </div>
        ) : null}
        {pickerError ? <p className="mt-2 text-sm text-red-600">{pickerError}</p> : null}
      </Form>

      <Form method="post" className="mb-8 rounded-lg border border-gray-200 bg-white p-4">
        <input type="hidden" name="intent" value="create-chat-space" />
        <input type="hidden" name="externalId" value={selectedSpace?.name ?? ""} />
        <input type="hidden" name="title" value={selectedSpace?.displayName ?? ""} />
        <p className="text-sm font-medium text-gray-700">{t("sources.chat_label")}</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={loadChatSpaces}
            disabled={chatLoading}
            className="flex items-center justify-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {chatLoading ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <MessageSquare className="size-4" />
            )}
            {t("sources.load_chat_spaces")}
          </button>
          <select
            value={selectedSpaceName}
            onChange={(event) => setSelectedSpaceName(event.target.value)}
            disabled={chatSpaces.length === 0}
            aria-label={t("sources.chat_space_label")}
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
          >
            <option value="" disabled>
              {t("sources.chat_space_placeholder")}
            </option>
            {chatSpaces.map((space) => (
              <option key={space.name} value={space.name}>
                {space.displayName}
              </option>
            ))}
          </select>
          <ChapterSelect chapters={assignableChapters} language={i18n.language} t={t} />
          <button
            type="submit"
            disabled={submitting || !selectedSpace}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {t("sources.add_chat_space")}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">{t("sources.chat_hint")}</p>
        {needsChatReauth ? (
          <div className="mt-3 flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
            <span>{t("sources.chat_reauth_hint")}</span>
            <button
              type="button"
              onClick={connectGoogleDrive}
              className="font-medium text-blue-600 hover:text-blue-700"
            >
              {t("sources.connect_google_drive")}
            </button>
          </div>
        ) : null}
        {chatError ? <p className="mt-2 text-sm text-red-600">{chatError}</p> : null}
      </Form>

      {actionData && !actionData.ok ? (
        <p className="mb-6 text-sm text-red-600">
          {t(`sources.error_${actionData.error}`, { defaultValue: t("sources.error_generic") })}
        </p>
      ) : null}

      {sources.length === 0 ? (
        <p className="text-sm text-gray-500">{t("sources.empty")}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full table-fixed divide-y divide-gray-200 text-sm">
            <colgroup>
              <col className="w-10" />
              <col />
              <col className="w-28" />
              <col className="w-24" />
              <col className="w-24" />
              <col className="w-36" />
              <col className="w-40" />
            </colgroup>
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2" />
                <th className="px-3 py-2">{t("sources.col_title")}</th>
                <th className="px-3 py-2">{t("sources.col_kind")}</th>
                <th className="px-3 py-2">{t("sources.col_status")}</th>
                <th className="px-3 py-2">{t("sources.col_documents")}</th>
                <th className="px-3 py-2">{t("sources.col_fetched")}</th>
                <th className="px-3 py-2">{t("sources.col_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sources.map((source) => {
                const open = expanded[source.id] ?? false;
                return (
                  <SourceRows
                    key={source.id}
                    source={source}
                    open={open}
                    onToggle={() => setExpanded((prev) => ({ ...prev, [source.id]: !open }))}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ChapterSelect({
  chapters,
  language,
  t,
}: {
  chapters: Array<{ id: string; nameJa: string; nameEn: string }>;
  language: string;
  t: (key: string) => string;
}) {
  return (
    <select
      name="chapter"
      required
      defaultValue={chapters.length === 1 ? chapters[0].id : ""}
      aria-label={t("sources.chapter_label")}
      className="rounded-md border border-gray-300 px-3 py-2 text-sm"
    >
      <option value="" disabled>
        {t("sources.chapter_placeholder")}
      </option>
      {chapters.map((chapter) => (
        <option key={chapter.id} value={chapter.id}>
          {language.startsWith("en") ? chapter.nameEn : chapter.nameJa}
        </option>
      ))}
      <option value={ALL_CHAPTERS}>{t("sources.chapter_all")}</option>
    </select>
  );
}

function SourceRows({
  source,
  open,
  onToggle,
}: {
  source: {
    id: string;
    title: string;
    url: string;
    kind: string;
    status: string;
    errorMessage: string | null;
    lastFetchedAt: Date | string | null;
    documents: Array<{
      id: string;
      path: string;
      title: string;
      contentHash: string;
      capturedAt: Date | string;
      status: string;
    }>;
  };
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const refreshFetcher = useFetcher();
  const archiveFetcher = useFetcher();
  const busy = refreshFetcher.state !== "idle" || archiveFetcher.state !== "idle";

  const fetchedLabel = source.lastFetchedAt ? new Date(source.lastFetchedAt).toLocaleString() : "—";

  return (
    <>
      <tr className="align-top">
        <td className="px-3 py-3">
          <button
            type="button"
            onClick={onToggle}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
            aria-expanded={open}
            aria-label={t("sources.toggle_documents")}
          >
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </td>
        <td className="min-w-0 px-3 py-3">
          <div className="truncate font-medium text-gray-900" title={source.title}>
            {source.title}
          </div>
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 block truncate text-xs text-blue-600 hover:underline"
            title={source.url}
          >
            {source.url}
          </a>
          {source.errorMessage ? (
            <p className="mt-1 text-xs text-red-600">{source.errorMessage}</p>
          ) : null}
        </td>
        <td className="px-3 py-3 text-gray-600">{t(`sources.kind.${source.kind}`, source.kind)}</td>
        <td className="px-3 py-3">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(source.status)}`}
          >
            {t(`sources.status.${source.status}`, source.status)}
          </span>
        </td>
        <td className="px-3 py-3 text-gray-600">{source.documents.length}</td>
        <td className="px-3 py-3 text-gray-600">{fetchedLabel}</td>
        <td className="px-3 py-3">
          <div className="flex flex-wrap gap-2">
            <refreshFetcher.Form method="post">
              <input type="hidden" name="intent" value="refresh" />
              <input type="hidden" name="sourceId" value={source.id} />
              <button
                type="submit"
                disabled={busy || source.status === "archived"}
                className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
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
                disabled={busy || source.status === "archived"}
                className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
              >
                {t("sources.archive")}
              </button>
            </archiveFetcher.Form>
          </div>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={7} className="bg-gray-50 px-6 py-3">
            {source.documents.length === 0 ? (
              <p className="text-xs text-gray-500">{t("sources.no_documents")}</p>
            ) : (
              <ul className="space-y-1">
                {source.documents.map((doc) => (
                  <li key={doc.id} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700">
                    <span className="font-medium">{doc.title}</span>
                    <span className="text-gray-500">{doc.path}</span>
                    <span className="font-mono text-gray-400">{doc.contentHash.slice(0, 12)}…</span>
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
