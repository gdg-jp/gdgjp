import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gdgjp/design-system";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChapterSelect, VisibilitySelect } from "~/features/sources/components/source-selects";
import { isSourceVisibility, sourceVisibilityNeedsChapter } from "~/features/sources/shared";
import { DiscordChannelDialog } from "./DiscordChannelDialog";
import { StagedCandidateList } from "./StagedCandidateList";
import { useDrivePicker } from "./use-drive-picker";
import { useSourceStaging } from "./use-source-staging";

/**
 * The `/sources` "add candidate" panel: Drive picker, Chat spaces, Discord
 * channels, and raw URLs are staged locally (see `useSourceStaging`), then
 * submitted as one batch with a shared visibility / chapter scope.
 * `discordError` / `needsDiscord*` are kept here (not inside the dialog) so an
 * auth hint or duplicate message shows in this section after the dialog closes.
 */
import { Icons } from "@gdgjp/design-system";
import { REGISTRATIONS, SOURCE_KINDS } from "~/features/sources/kinds";
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
    submitting,
    submitBatch,
    addCandidates,
    removeCandidate,
    addUrlCandidate,
    updateUrlCandidate,
  } = useSourceStaging(sources);
  const [needsDriveConnection, setNeedsDriveConnection] = useState(false);
  const drivePicker = useDrivePicker({
    addCandidates,
    onNeedsConnection: () => setNeedsDriveConnection(true),
  });
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
  const needsChapter = isSourceVisibility(visibility) && sourceVisibilityNeedsChapter(visibility);
  const urlCandidatesValid = candidates.every(
    (candidate) => REGISTRATIONS[candidate.kind].validate(candidate) === null,
  );
  const canSubmitImport = Boolean(
    visibility && (!needsChapter || chapter) && candidates.length > 0 && urlCandidatesValid,
  );

  useEffect(() => {
    if (chatSpacesLoadStarted.current) return;
    chatSpacesLoadStarted.current = true;
    void loadChatSpaces();
  }, []);

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
    const candidateId = SOURCE_KINDS["google-chat-space"].candidateId(space.name);
    if (registeredCandidateIds.has(candidateId)) {
      setChatError(t("sources.error_duplicate_source"));
      return;
    }
    setChatError(null);
    addCandidates([
      {
        id: candidateId,
        kind: "google-chat-space",
        title: space.displayName,
        url: `https://mail.google.com/chat/u/0/#chat/space/${space.name.slice("spaces/".length)}`,
        externalId: space.name,
      },
    ]);
  }

  return (
    <section className="mb-8 rounded-lg border border-border bg-surface p-4">
      <div>
        <p className="mb-2 text-sm font-medium text-foreground">{t("sources.add_candidate")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setNeedsDriveConnection(false);
              void drivePicker.open();
            }}
            disabled={drivePicker.loading}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted hover:bg-neutral disabled:opacity-60"
          >
            {drivePicker.loading ? (
              <Icons name="LoaderCircle" className="size-4 animate-spin" />
            ) : (
              <Icons name="FileText" className="size-4" />
            )}
            {t("sources.choose_google_drive")}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted hover:bg-neutral"
              >
                {chatLoading ? (
                  <Icons name="LoaderCircle" className="size-4 animate-spin" />
                ) : (
                  <Icons name="MessageSquare" className="size-4" />
                )}
                {t("sources.add_chat_space")}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56">
              {chatLoading ? (
                <DropdownMenuItem disabled>
                  <Icons name="LoaderCircle" className="size-4 animate-spin" />
                  {t("sources.chat_space_placeholder")}
                </DropdownMenuItem>
              ) : (
                chatSpaces.map((space) => (
                  <DropdownMenuItem
                    key={space.name}
                    disabled={registeredCandidateIds.has(
                      SOURCE_KINDS["google-chat-space"].candidateId(space.name),
                    )}
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
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted hover:bg-neutral"
          >
            <Icons name="Hash" className="size-4" />
            {t("sources.add_discord_server")}
          </button>
          <button
            type="button"
            onClick={addUrlCandidate}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted hover:bg-neutral"
          >
            <Icons name="Link2" className="size-4" />
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
              onClick={() => submitBatch({ visibility, chapter: needsChapter ? chapter : "" })}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 sm:min-w-24"
            >
              {submitting ? <Icons name="LoaderCircle" className="size-4 animate-spin" /> : null}
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
          <div className="mt-3 flex items-center gap-3 rounded-md border border-border bg-neutral p-3 text-sm">
            <span>{t("sources.connect_hint")}</span>
            <button
              type="button"
              onClick={connectGoogleDrive}
              className="font-medium text-link hover:text-link"
            >
              {t("sources.connect_google_drive")}
            </button>
          </div>
        ) : null}
        {needsDiscordConnection || needsDiscordReauth ? (
          <div className="mt-3 flex items-center gap-3 rounded-md border border-border bg-neutral p-3 text-sm">
            <span>
              {needsDiscordReauth
                ? t("sources.discord_reauth_hint")
                : t("sources.connect_discord_hint")}
            </span>
            <button
              type="button"
              onClick={connectDiscord}
              className="font-medium text-link hover:text-link"
            >
              {t("sources.connect_discord")}
            </button>
          </div>
        ) : null}
        {drivePicker.error ? <p className="mt-2 text-sm text-danger">{drivePicker.error}</p> : null}
        {needsChatReauth ? (
          <div className="mt-3 flex items-center gap-3 rounded-md border border-warning bg-[var(--gdg-warning-surface)] p-3 text-sm text-warning">
            <span>{t("sources.chat_reauth_hint")}</span>
            <button
              type="button"
              onClick={connectGoogleDrive}
              className="font-medium text-link hover:text-link"
            >
              {t("sources.connect_google_drive")}
            </button>
          </div>
        ) : null}
        {chatError ? <p className="mt-2 text-sm text-danger">{chatError}</p> : null}
        {discordError && !discordDialogOpen ? (
          <p className="mt-2 text-sm text-danger">{discordError}</p>
        ) : null}
        {!submitting && Object.keys(candidateErrors).length > 0 ? (
          <p className="mt-2 text-sm text-danger">{t("sources.batch_partial_failure")}</p>
        ) : null}
        {batchFetcher.data && !batchFetcher.data.ok ? (
          <p className="mt-2 text-sm text-danger">
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
