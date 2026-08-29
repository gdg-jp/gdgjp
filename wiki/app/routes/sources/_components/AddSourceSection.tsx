import { FileText, Hash, Link2, LoaderCircle, MessageSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { loadGooglePicker } from "~/features/google/picker.client";
import type { GooglePickerConfig } from "~/features/google/picker.client";
import { ChapterSelect, VisibilitySelect } from "~/features/sources/components/source-selects";
import { isSourceVisibility, sourceVisibilityNeedsChapter } from "~/features/sources/shared";
import {
  SOURCE_MIME_TYPES,
  isHttpUrl,
  sourceUrlFromGoogleDocument,
} from "~/features/sources/staged-candidates";
import { DiscordChannelDialog } from "./DiscordChannelDialog";
import { StagedCandidateList } from "./StagedCandidateList";
import { useSourceStaging } from "./use-source-staging";

/**
 * The `/sources` "add candidate" panel: Drive picker, Chat spaces, Discord
 * channels, and raw URLs are staged locally (see `useSourceStaging`), then
 * submitted as one batch with a shared visibility / chapter scope.
 * `discordError` / `needsDiscord*` are kept here (not inside the dialog) so an
 * auth hint or duplicate message shows in this section after the dialog closes.
 */
export function AddSourceSection({
  sources,
  assignableChapters,
}: {
  sources: ReadonlyArray<{ externalId: string | null; kind: string }>;
  assignableChapters: Array<{ id: string; nameJa: string; nameEn: string }>;
}) {
  const { t, i18n } = useTranslation();
  const {
    candidates,
    candidateErrors,
    registeredCandidateIds,
    batchFetcher,
    addCandidates,
    removeCandidate,
    addUrlCandidate,
    updateUrlCandidate,
  } = useSourceStaging(sources);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [needsDriveConnection, setNeedsDriveConnection] = useState(false);
  const [chatSpaces, setChatSpaces] = useState<
    Array<{ name: string; displayName: string; spaceType: string | null }>
  >([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [needsChatReauth, setNeedsChatReauth] = useState(false);
  const [discordDialogOpen, setDiscordDialogOpen] = useState(false);
  const [discordError, setDiscordError] = useState<string | null>(null);
  const [needsDiscordConnection, setNeedsDiscordConnection] = useState(false);
  const [needsDiscordReauth, setNeedsDiscordReauth] = useState(false);
  const chatSpacesLoadStarted = useRef(false);
  const [visibility, setVisibility] = useState("");
  const [chapter, setChapter] = useState(
    assignableChapters.length === 1 ? assignableChapters[0].id : "",
  );
  const submitting = batchFetcher.state !== "idle";
  const needsChapter = isSourceVisibility(visibility) && sourceVisibilityNeedsChapter(visibility);
  const urlCandidatesValid = candidates.every(
    (candidate) => candidate.kind !== "url" || isHttpUrl(candidate.url),
  );
  const canSubmitImport = Boolean(
    visibility && (!needsChapter || chapter) && candidates.length > 0 && urlCandidatesValid,
  );

  useEffect(() => {
    if (chatSpacesLoadStarted.current) return;
    chatSpacesLoadStarted.current = true;
    void loadChatSpaces();
  }, []);

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
            } else if (addCandidates(selected)) {
              setPickerError(t("sources.error_duplicate_source"));
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

  function connectDiscord() {
    window.location.assign("/api/discord/auth?returnTo=%2Fsources");
  }

  function addChatSpace(space: (typeof chatSpaces)[number]) {
    if (registeredCandidateIds.has(`chat:${space.name}`)) {
      setChatError(t("sources.error_duplicate_source"));
      return;
    }
    setChatError(null);
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
    <section className="mb-8 rounded-lg border border-border-default bg-surface-raised p-4">
      <div>
        <p className="mb-2 text-sm font-medium text-content-primary">
          {t("sources.add_candidate")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={chooseGoogleDriveSource}
            disabled={pickerLoading}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-content-secondary hover:bg-surface-hover disabled:opacity-60"
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
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-content-secondary hover:bg-surface-hover"
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
                  <DropdownMenuItem
                    key={space.name}
                    disabled={registeredCandidateIds.has(`chat:${space.name}`)}
                    onSelect={() => addChatSpace(space)}
                  >
                    {space.displayName}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={() => setDiscordDialogOpen(true)}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-content-secondary hover:bg-surface-hover"
          >
            <Hash className="size-4" />
            {t("sources.add_discord_channel")}
          </button>
          <button
            type="button"
            onClick={addUrlCandidate}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-content-secondary hover:bg-surface-hover"
          >
            <Link2 className="size-4" />
            {t("sources.add_url")}
          </button>
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:ml-auto">
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
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-60 sm:min-w-24"
            >
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t("sources.add")}
            </button>
          </div>
        </div>
      </div>
      <div>
        <StagedCandidateList
          candidates={candidates}
          candidateErrors={candidateErrors}
          onRemove={removeCandidate}
          onUpdateUrl={updateUrlCandidate}
        />
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
        {needsDiscordConnection || needsDiscordReauth ? (
          <div className="mt-3 flex items-center gap-3 rounded-md border border-border-default bg-surface-sunken p-3 text-sm">
            <span>
              {needsDiscordReauth
                ? t("sources.discord_reauth_hint")
                : t("sources.connect_discord_hint")}
            </span>
            <button
              type="button"
              onClick={connectDiscord}
              className="font-medium text-action-primary hover:text-action-primary-hover"
            >
              {t("sources.connect_discord")}
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
        {discordError && !discordDialogOpen ? (
          <p className="mt-2 text-sm text-feedback-danger-foreground">{discordError}</p>
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
      <DiscordChannelDialog
        open={discordDialogOpen}
        onOpenChange={setDiscordDialogOpen}
        registeredCandidateIds={registeredCandidateIds}
        error={discordError}
        onErrorChange={setDiscordError}
        needsConnection={needsDiscordConnection}
        needsReauth={needsDiscordReauth}
        onNeedsConnectionChange={setNeedsDiscordConnection}
        onNeedsReauthChange={setNeedsDiscordReauth}
        onStage={addCandidates}
      />
    </section>
  );
}
