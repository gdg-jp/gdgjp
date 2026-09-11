import {
  ArrowRight,
  Clipboard,
  Copy,
  Link as LinkIcon,
  MoreHorizontal,
  MoveHorizontal,
  Trash2,
  Type,
} from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Await, useFetcher, useLocation } from "react-router";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { displayedMarkdown } from "~/features/pages/page-menu-content";
import type { PageDisplay } from "~/features/pages/use-page-display";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPrimitiveSwitch,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./page-menu-primitives";

type Targets = {
  targets?: { id: string; titleJa: string; titleEn: string; slug: string }[];
  error?: string;
};

export function PageActionsMenu({
  pageId,
  title,
  lang,
  content,
  canManage,
  onArchive,
  display,
  onDisplayChange,
  mobileActions,
}: {
  pageId: string;
  title: string;
  lang: "ja" | "en";
  content: Promise<{ contentJa: string; contentEn: string }>;
  canManage: boolean;
  onArchive: () => void;
  display: PageDisplay;
  onDisplayChange: (value: PageDisplay) => void;
  mobileActions: ReactNode;
}) {
  const { t } = useTranslation("common");
  const location = useLocation();
  const mutation = useFetcher<{ error?: string }>();
  const targets = useFetcher<Targets>();
  const [moveOpen, setMoveOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const busy = mutation.state !== "idle";
  const actionError = mutation.data?.error;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(t("wiki.menu.copied"));
    } catch {
      setMessage(t("wiki.menu.copy_failed"));
    }
  }
  function move(parentId: string) {
    mutation.submit({ intent: "movePage", parentId, lang }, { method: "post" });
  }
  const copyItem = (text?: string) => (
    <DropdownMenuItem
      disabled={text === undefined}
      onSelect={() => {
        if (text !== undefined) void copy(`# ${title}\n\n${text}`);
      }}
    >
      <Clipboard />
      {t("wiki.menu.copy_contents")}
    </DropdownMenuItem>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            disabled={!hydrated}
            aria-label={t("wiki.menu.more")}
            className="rounded-md p-2 text-content-tertiary hover:bg-surface-hover hover:text-content-primary"
          >
            <MoreHorizontal size={18} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-72 max-w-[calc(100vw-2rem)] border border-border-default bg-surface-raised p-1.5 text-content-primary"
        >
          <DropdownMenuItem
            onSelect={() => void copy(`${window.location.origin}${location.pathname}?lang=${lang}`)}
          >
            <LinkIcon />
            {t("wiki.menu.copy_link")}
          </DropdownMenuItem>
          <Suspense fallback={copyItem()}>
            <Await resolve={content} errorElement={copyItem()}>
              {(resolved) => copyItem(displayedMarkdown(resolved, lang))}
            </Await>
          </Suspense>
          <DropdownMenuItem
            disabled={!canManage || busy}
            onSelect={() => mutation.submit({ intent: "duplicatePage", lang }, { method: "post" })}
          >
            <Copy />
            {t("wiki.menu.duplicate")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canManage || busy}
            onSelect={() => {
              setQuery("");
              setMoveOpen(true);
              targets.load(`/api/pages/move-targets?pageId=${encodeURIComponent(pageId)}`);
            }}
          >
            <ArrowRight />
            {t("wiki.menu.move")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canManage || busy} onSelect={onArchive}>
            <Trash2 />
            {t("wiki.menu.trash")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuPrimitiveSwitch
            checked={display.smallText}
            onCheckedChange={(checked) => onDisplayChange({ ...display, smallText: checked })}
          >
            <Type />
            {t("wiki.menu.small_text")}
          </DropdownMenuPrimitiveSwitch>
          <DropdownMenuPrimitiveSwitch
            checked={display.fullWidth}
            onCheckedChange={(checked) => onDisplayChange({ ...display, fullWidth: checked })}
          >
            <MoveHorizontal />
            {t("wiki.menu.full_width")}
          </DropdownMenuPrimitiveSwitch>
          <div className="md:hidden">
            <DropdownMenuSeparator />
            {mobileActions}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <output className="sr-only">{busy ? t("wiki.menu.working") : message}</output>
      {(busy || message || actionError) && (
        <div
          role={actionError ? "alert" : undefined}
          className="absolute right-4 top-full z-20 max-w-[calc(100vw-2rem)] rounded border border-border-default bg-surface-raised px-3 py-2 text-sm text-content-primary shadow"
        >
          {busy ? t("wiki.menu.working") : actionError ? t("wiki.menu.action_failed") : message}
        </div>
      )}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent
          className="p-5 sm:max-w-md"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <DialogTitle>{t("wiki.menu.move")}</DialogTitle>
          <DialogDescription>{t("wiki.menu.move_description")}</DialogDescription>
          <input
            aria-label={t("wiki.menu.search_pages")}
            placeholder={t("wiki.menu.search_pages")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded border border-border-default bg-surface-default px-3 py-2"
          />
          {actionError && <p role="alert">{t("wiki.menu.action_failed")}</p>}
          {targets.state !== "idle" ? (
            <output>{t("wiki.menu.loading")}</output>
          ) : targets.data?.targets ? (
            <div className="max-h-72 overflow-y-auto">
              <button
                type="button"
                disabled={busy}
                onClick={() => move("")}
                className="w-full rounded px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-50"
              >
                {t("wiki.menu.root")}
              </button>
              {targets.data.targets
                .filter((target) =>
                  `${target.titleJa} ${target.titleEn} ${target.slug}`
                    .toLocaleLowerCase()
                    .includes(query.toLocaleLowerCase()),
                )
                .map((target) => (
                  <button
                    key={target.id}
                    type="button"
                    disabled={busy}
                    onClick={() => move(target.id)}
                    className="block w-full rounded px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-50"
                  >
                    <span className="block">
                      {lang === "en"
                        ? target.titleEn || target.titleJa
                        : target.titleJa || target.titleEn}
                    </span>
                    <span className="text-xs text-content-tertiary">{target.slug}</span>
                  </button>
                ))}
            </div>
          ) : (
            <p role="alert">{t("wiki.menu.action_failed")}</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
