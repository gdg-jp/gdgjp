import { MdEditor } from "md-editor-rt";
import "md-editor-rt/lib/style.css";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useBlocker, useFetcher } from "react-router";
import PresenceAvatars from "~/components/PresenceAvatars";
import type { CollabUser } from "~/hooks/useCollabEditor";
import { useCollabEditor } from "~/hooks/useCollabEditor";
import { useThemeMode } from "~/hooks/useThemeMode";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Page {
  id: string;
  titleJa: string;
  titleEn: string;
  slug: string;
  contentJa: string;
  contentEn: string;
  visibility: string;
  origin: string;
}

interface PageEditorProps {
  page: Page;
  currentUser: CollabUser;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(
  isoString: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t("time.just_now");
  if (minutes < 60) return t("time.minutes_ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hours_ago", { count: hours });
  const days = Math.floor(hours / 24);
  return t("time.days_ago", { count: days });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PageEditor({ page, currentUser }: PageEditorProps) {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ ok: boolean; savedAt: string }>();
  const theme = useThemeMode();

  const [titleJa, setTitleJa] = useState(page.titleJa);
  const [titleEn, setTitleEn] = useState(page.titleEn);
  const [activeLang, setActiveLangLocal] = useState<"ja" | "en">("ja");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const isJaActive = activeLang === "ja";
  const isEnActive = activeLang === "en";

  // Collaborative editing hook
  const {
    contentJa,
    contentEn,
    setContentJa,
    setContentEn,
    peers,
    connected,
    setActiveLang: setCollabActiveLang,
  } = useCollabEditor({
    slug: page.slug,
    initialContentJa: page.contentJa,
    initialContentEn: page.contentEn,
    user: currentUser,
  });

  // Sync language tab with collab awareness
  const setActiveLang = useCallback(
    (lang: "ja" | "en") => {
      setActiveLangLocal(lang);
      setCollabActiveLang(lang);
    },
    [setCollabActiveLang],
  );

  // Track last saved content to detect dirty state
  const lastSavedRef = useRef({
    titleJa: page.titleJa,
    titleEn: page.titleEn,
    contentJa: page.contentJa,
    contentEn: page.contentEn,
  });

  // Snapshot of the payload that was actually submitted — updated at submit time,
  // not at response time, so concurrent edits don't incorrectly clear dirty state.
  const pendingSaveRef = useRef<typeof lastSavedRef.current | null>(null);

  const isDirty =
    titleJa !== lastSavedRef.current.titleJa ||
    titleEn !== lastSavedRef.current.titleEn ||
    contentJa !== lastSavedRef.current.contentJa ||
    contentEn !== lastSavedRef.current.contentEn;

  // Update lastSavedAt when autosave succeeds — use the submitted snapshot
  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.savedAt && pendingSaveRef.current) {
      setLastSavedAt(fetcher.data.savedAt);
      lastSavedRef.current = pendingSaveRef.current;
      pendingSaveRef.current = null;
    }
  }, [fetcher.data]);

  // Auto-save every 30s when dirty
  const submitAutosave = useCallback(() => {
    if (!isDirty) return;
    const snapshot = { titleJa, titleEn, contentJa, contentEn };
    pendingSaveRef.current = snapshot;
    const fd = new FormData();
    fd.set("intent", "autosave");
    fd.set("titleJa", titleJa);
    fd.set("titleEn", titleEn);
    fd.set("contentJa", contentJa);
    fd.set("contentEn", contentEn);
    fetcher.submit(fd, { method: "post" });
  }, [isDirty, titleJa, titleEn, contentJa, contentEn, fetcher]);

  useEffect(() => {
    const id = setInterval(submitAutosave, 30_000);
    return () => clearInterval(id);
  }, [submitAutosave]);

  // Navigation guard when dirty
  useBlocker(() => isDirty && fetcher.state === "idle");

  // Image upload callback for the markdown editor
  const handleUploadImg = useCallback(
    async (files: File[], callback: (urls: string[]) => void) => {
      const urls: string[] = [];
      for (const file of files) {
        const fd = new FormData();
        fd.set("image", file);
        const res = await fetch(`/api/wiki/${page.slug}/upload-image`, {
          method: "post",
          body: fd,
        });
        if (res.ok) {
          const data = (await res.json()) as { url: string };
          urls.push(data.url);
        }
      }
      callback(urls);
    },
    [page.slug],
  );

  // Autosave status text
  let statusText: string | null = null;
  if (fetcher.state !== "idle") {
    statusText = t("editor.saving");
  } else if (fetcher.data && !fetcher.data.ok) {
    statusText = t("editor.autosave_failed");
  } else if (lastSavedAt) {
    statusText = t("editor.saved_at", { time: formatRelativeTime(lastSavedAt, t) });
  }

  return (
    <fetcher.Form
      method="post"
      className="flex flex-col"
      style={{ height: "calc(100dvh - 3.5rem)" }}
    >
      {/* Hidden content fields — always kept in sync */}
      <input type="hidden" name="contentJa" value={contentJa} />
      <input type="hidden" name="contentEn" value={contentEn} />

      {page.origin === "agent" && (
        <div className="border-b border-feedback-warning-border bg-feedback-warning-surface px-3 py-2 text-sm text-feedback-warning-foreground">
          {t("wiki.ingest_managed_warning")}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Mini-header                                                          */}
      {/* ------------------------------------------------------------------ */}
      <div className="sticky top-14 z-10 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-default bg-surface-raised px-3 py-2 shadow-sm">
        {/* Back + title */}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Link
            to={`/wiki/${page.slug}`}
            className="shrink-0 rounded-md p-1.5 text-content-secondary hover:bg-surface-sunken hover:text-content-secondary"
            aria-label={t("editor.back_to_page")}
          >
            <ArrowLeft size={18} />
          </Link>

          {/* Title inputs — toggled by active language, both always in DOM */}
          <input
            name="titleJa"
            value={titleJa}
            onChange={(e) => setTitleJa(e.target.value)}
            placeholder={t("editor.title_ja")}
            required={isJaActive}
            aria-hidden={!isJaActive}
            className={`min-w-0 flex-1 rounded bg-transparent px-2 py-1 text-base font-medium text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-border-focus ${!isJaActive ? "hidden" : ""}`}
          />
          <input
            name="titleEn"
            value={titleEn}
            onChange={(e) => setTitleEn(e.target.value)}
            placeholder={t("editor.title_en")}
            aria-hidden={!isEnActive}
            className={`min-w-0 flex-1 rounded bg-transparent px-2 py-1 text-base font-medium text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-border-focus ${!isEnActive ? "hidden" : ""}`}
          />
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center justify-end gap-2 ml-auto">
          {/* Presence avatars */}
          <PresenceAvatars peers={peers} />

          {/* Connection status dot */}
          <span className="group relative hidden sm:inline-flex">
            <span
              role="status"
              aria-label={connected ? t("editor.connected") : t("editor.disconnected")}
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${connected ? "bg-feedback-success-solid" : "bg-border-strong"}`}
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-content-primary px-2 py-1 text-xs text-content-inverse opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              {connected ? t("editor.connected") : t("editor.disconnected")}
            </span>
          </span>

          {/* Autosave status */}
          {statusText && (
            <span
              className={`hidden shrink-0 text-xs sm:inline ${fetcher.data && !fetcher.data.ok ? "text-feedback-danger-foreground" : "text-content-tertiary"}`}
            >
              {statusText}
            </span>
          )}

          {/* Language switcher */}
          <div className="flex shrink-0 overflow-hidden rounded-md border border-default">
            {(["ja", "en"] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setActiveLang(lang)}
                className={`px-3 py-1 text-sm font-medium transition-colors ${
                  activeLang === lang
                    ? "bg-action-primary text-content-inverse hover:bg-action-primary-hover"
                    : "bg-surface-raised text-content-secondary hover:bg-surface-canvas hover:text-content-secondary"
                }`}
              >
                {lang === "ja" ? t("language.ja") : t("language.en")}
              </button>
            ))}
          </div>

          <button
            type="submit"
            name="intent"
            value="save"
            className="shrink-0 rounded-lg border border-strong px-3 py-1.5 text-sm font-medium text-content-secondary hover:bg-surface-canvas focus:outline-none focus:ring-2 focus:ring-border-focus"
          >
            {t("editor.save")}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Editor body — no padding, full size                                 */}
      {/* ------------------------------------------------------------------ */}
      <div className={`min-h-0 flex-1 ${isJaActive ? "" : "hidden"}`}>
        <MdEditor
          editorId="editor-ja"
          modelValue={contentJa}
          onChange={setContentJa}
          language="en-US"
          theme={theme}
          onUploadImg={handleUploadImg}
          style={{ height: "100%" }}
        />
      </div>
      <div className={`min-h-0 flex-1 ${isEnActive ? "" : "hidden"}`}>
        <MdEditor
          editorId="editor-en"
          modelValue={contentEn}
          onChange={setContentEn}
          language="en-US"
          theme={theme}
          onUploadImg={handleUploadImg}
          style={{ height: "100%" }}
        />
      </div>
    </fetcher.Form>
  );
}
