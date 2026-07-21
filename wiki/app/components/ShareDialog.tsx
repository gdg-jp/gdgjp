import {
  Check,
  ChevronLeft,
  Copy,
  Globe2,
  Link2,
  Loader2,
  LockKeyhole,
  Send,
  Share2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { MotionPresence, MotionSwap } from "~/components/ui/motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

type PageRole = "viewer" | "commenter" | "editor";
type GeneralAccess = "restricted" | "unlisted" | "public";
type SubjectType = "email" | "chapter";

interface ShareSubject {
  type: SubjectType;
  key: string;
  label: string;
  secondary: string;
  image?: string | null;
  userId?: string | null;
}

interface PageAccessEntry {
  id: string;
  subjectType?: SubjectType;
  subjectKey?: string;
  subjectLabel?: string;
  role?: PageRole;
  userName?: string | null;
  userImage?: string | null;
  email?: string;
  pageRole?: PageRole;
  userId?: string | null;
}

interface AccessData {
  accessList: PageAccessEntry[];
  owner?: { label?: string; name?: string; email?: string; image?: string | null } | null;
  myRole?: "owner" | PageRole | null;
  canManageSharing?: boolean;
  permissions?: { canManageSharing?: boolean };
  generalAccess?: GeneralAccess;
  generalRole?: PageRole;
  visibility?: GeneralAccess;
}

interface CandidateData {
  candidates: Array<
    Partial<ShareSubject> & {
      subjectType?: SubjectType;
      subjectKey?: string;
      subjectLabel?: string;
      secondaryText?: string;
    }
  >;
}

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  pageId: string;
  pageTitle: string;
  /** Kept optional while callers move to the new page-access response. */
  currentVisibility?: string;
  canManageAccess?: boolean;
  canChangeVisibility?: boolean;
}

const ROLES: PageRole[] = ["viewer", "commenter", "editor"];
const listboxRole = "listbox";
const optionRole = "option";
const GENERAL_ACCESS: { value: GeneralAccess; icon: typeof LockKeyhole; label: string }[] = [
  { value: "restricted", icon: LockKeyhole, label: "share_access_restricted" },
  { value: "unlisted", icon: Link2, label: "share_access_unlisted" },
  { value: "public", icon: Globe2, label: "share_access_public" },
];

function initial(value: string) {
  return value.trim().charAt(0).toLocaleUpperCase() || "?";
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function Avatar({ subject, size = "h-10 w-10" }: { subject: ShareSubject; size?: string }) {
  if (subject.image) {
    return (
      <img
        src={subject.image}
        alt=""
        className={`${size} shrink-0 rounded-full object-cover ring-1 ring-black/10 dark:ring-white/10`}
      />
    );
  }
  const ChapterIcon = subject.type === "chapter" ? UsersRound : UserRound;
  return (
    <span
      aria-hidden="true"
      className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700`}
    >
      {subject.type === "chapter" ? <ChapterIcon size={18} /> : initial(subject.label)}
    </span>
  );
}

function AccessIcon({ value }: { value: GeneralAccess }) {
  const Icon = GENERAL_ACCESS.find((option) => option.value === value)?.icon ?? LockKeyhole;
  return <Icon size={20} aria-hidden="true" />;
}

function normalizeEntry(entry: PageAccessEntry): ShareSubject & { id: string; role: PageRole } {
  const type = entry.subjectType ?? "email";
  const secondary =
    type === "chapter" ? (entry.subjectKey ?? "") : (entry.email ?? entry.subjectKey ?? "");
  return {
    id: entry.id,
    type,
    key: entry.subjectKey ?? secondary,
    label: entry.subjectLabel ?? entry.userName ?? entry.email ?? secondary,
    secondary,
    image: entry.userImage,
    userId: entry.userId,
    role: entry.role ?? entry.pageRole ?? "viewer",
  };
}

function normalizeCandidate(candidate: CandidateData["candidates"][number]): ShareSubject | null {
  const type = candidate.type ?? candidate.subjectType;
  const key = candidate.key ?? candidate.subjectKey;
  const label = candidate.label ?? candidate.subjectLabel;
  if ((type !== "email" && type !== "chapter") || !key || !label) return null;
  return {
    type,
    key,
    label,
    secondary: candidate.secondary ?? candidate.secondaryText ?? key,
    image: candidate.image,
  };
}

export default function ShareDialog({
  open,
  onClose,
  pageId,
  pageTitle,
  currentVisibility = "restricted",
  canManageAccess = false,
  canChangeVisibility = false,
}: ShareDialogProps) {
  const { t } = useTranslation("common");
  const accessFetcher = useFetcher<AccessData>();
  const candidatesFetcher = useFetcher<CandidateData>();
  const mutationFetcher = useFetcher<{
    ok?: boolean;
    error?: string;
    warning?: string;
    notificationFailures?: number;
  }>();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchAreaRef = useRef<HTMLDivElement>(null);
  const processedMutation = useRef<unknown>(undefined);
  const listboxId = useId();

  const [screen, setScreen] = useState<"overview" | "grant">("overview");
  const [query, setQuery] = useState("");
  const [isListOpen, setIsListOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selected, setSelected] = useState<ShareSubject[]>([]);
  const [grantRole, setGrantRole] = useState<PageRole>("viewer");
  const [notify, setNotify] = useState(true);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [localAccess, setLocalAccess] = useState<GeneralAccess>(currentVisibility as GeneralAccess);
  const [localGeneralRole, setLocalGeneralRole] = useState<PageRole>("viewer");

  const responseCanManage =
    accessFetcher.data?.canManageSharing ?? accessFetcher.data?.permissions?.canManageSharing;
  const canManage = responseCanManage ?? canManageAccess;
  const accessList = useMemo(
    () => (accessFetcher.data?.accessList ?? []).map(normalizeEntry),
    [accessFetcher.data?.accessList],
  );
  const grantedKeys = useMemo(
    () => new Set(accessList.map((item) => `${item.type}:${item.key}`)),
    [accessList],
  );
  const candidateRows = useMemo(() => {
    const candidates = (candidatesFetcher.data?.candidates ?? []).flatMap((candidate) => {
      const normalized = normalizeCandidate(candidate);
      return normalized ? [normalized] : [];
    });
    const normalizedQuery = query.trim().toLowerCase();
    const rows = candidates.filter(
      (candidate) =>
        !grantedKeys.has(`${candidate.type}:${candidate.key}`) &&
        !selected.some((item) => item.type === candidate.type && item.key === candidate.key),
    );
    if (
      isEmail(query) &&
      !rows.some(
        (candidate) =>
          candidate.type === "email" && candidate.key.toLowerCase() === normalizedQuery,
      )
    ) {
      rows.unshift({
        type: "email",
        key: query.trim().toLowerCase(),
        label: query.trim(),
        secondary: t("wiki.share_unregistered"),
      });
    }
    return rows;
  }, [candidatesFetcher.data?.candidates, grantedKeys, query, selected, t]);

  const isMutating = mutationFetcher.state !== "idle";
  const isLoading = accessFetcher.state !== "idle" && !accessFetcher.data;

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher functions are stable
  useEffect(() => {
    if (!open) return;
    setScreen("overview");
    setQuery("");
    setSelected([]);
    setError(null);
    setWarning(null);
    setLocalAccess(currentVisibility as GeneralAccess);
    accessFetcher.load(`/api/page-access/${pageId}`);
  }, [open, pageId]);

  useEffect(() => {
    if (!accessFetcher.data) return;
    setLocalAccess(
      accessFetcher.data.generalAccess ?? accessFetcher.data.visibility ?? "restricted",
    );
    setLocalGeneralRole(accessFetcher.data.generalRole ?? "viewer");
  }, [accessFetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher functions are stable
  useEffect(() => {
    if (!open || !isListOpen) return;
    const timer = window.setTimeout(() => {
      candidatesFetcher.load(
        `/api/share-candidates?pageId=${encodeURIComponent(pageId)}&q=${encodeURIComponent(query)}`,
      );
    }, 160);
    return () => window.clearTimeout(timer);
  }, [open, isListOpen, query]);

  useEffect(() => {
    if (!open || !isListOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!searchAreaRef.current?.contains(event.target as Node)) {
        setIsListOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, isListOpen]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(Math.max(index, 0), Math.max(candidateRows.length - 1, 0)));
  }, [candidateRows.length]);

  // Refresh authoritative state only once a mutation completes. Local selection is retained for
  // role/access edits and reset only after a successful batch grant.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher functions are stable
  useEffect(() => {
    if (mutationFetcher.state !== "idle" || !mutationFetcher.data) return;
    if (processedMutation.current === mutationFetcher.data) return;
    processedMutation.current = mutationFetcher.data;
    if (mutationFetcher.data.error) {
      setError(t("wiki.share_error_generic", { defaultValue: mutationFetcher.data.error }));
      return;
    }
    setError(null);
    setWarning(
      mutationFetcher.data.warning ??
        ("notificationFailures" in mutationFetcher.data && mutationFetcher.data.notificationFailures
          ? t("wiki.share_notification_warning")
          : null),
    );
    accessFetcher.load(`/api/page-access/${pageId}`);
    if (screen === "grant") {
      setSelected([]);
      setQuery("");
      setMessage("");
      setScreen("overview");
    }
  }, [mutationFetcher.state, mutationFetcher.data, pageId, screen, t]);

  function close() {
    if (isMutating) return;
    onClose();
  }

  function chooseCandidate(subject: ShareSubject) {
    inputRef.current?.blur();
    setSelected((items) => [...items, subject]);
    setQuery("");
    setIsListOpen(false);
    setActiveIndex(0);
    setScreen("grant");
  }

  function removeSelection(subject: ShareSubject) {
    setSelected((items) =>
      items.filter((item) => item.type !== subject.type || item.key !== subject.key),
    );
  }

  function submitMutation(body: Record<string, unknown>) {
    setError(null);
    setWarning(null);
    mutationFetcher.submit(JSON.stringify(body), {
      method: "post",
      action: `/api/page-access/${pageId}`,
      encType: "application/json",
    });
  }

  function grantSelected() {
    if (!selected.length) return;
    submitMutation({
      intent: "batchGrant",
      subjects: selected.map(({ type, key, label }) => ({ type, key, label })),
      targets: selected.map(({ type, key, label }) => ({ type, key, label })),
      role: grantRole,
      notify,
      message,
      pageTitle,
      pageUrl: window.location.href,
    });
  }

  function updateRole(accessId: string, role: PageRole) {
    submitMutation({ intent: "update", accessId, role });
  }

  function removeAccess(accessId: string) {
    submitMutation({ intent: "remove", accessId });
  }

  function changeAccess(entry: (typeof accessList)[number], value: string) {
    if (value === "transfer") {
      submitMutation({ intent: "transfer", accessId: entry.id });
    } else if (value === "remove") {
      removeAccess(entry.id);
    } else {
      updateRole(entry.id, value as PageRole);
    }
  }

  function setGeneralAccess(generalAccess: GeneralAccess, generalRole = localGeneralRole) {
    setLocalAccess(generalAccess);
    setLocalGeneralRole(generalRole);
    submitMutation({
      intent: "setGeneralAccess",
      generalAccess,
      visibility: generalAccess,
      generalRole,
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(t("wiki.share_copy_failed"));
    }
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsListOpen(true);
      setActiveIndex((index) => Math.min(index + 1, Math.max(candidateRows.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsListOpen(true);
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home" && isListOpen) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && isListOpen) {
      event.preventDefault();
      setActiveIndex(Math.max(candidateRows.length - 1, 0));
    } else if (event.key === "Enter" && isListOpen && candidateRows[activeIndex]) {
      event.preventDefault();
      chooseCandidate(candidateRows[activeIndex]);
    }
  }

  function handleEscapeKeyDown(event: Event) {
    event.preventDefault();
    if (isListOpen) setIsListOpen(false);
    else if (screen === "grant") setScreen("overview");
    else close();
  }

  const owner = accessFetcher.data?.owner;
  const ownerSubject: ShareSubject | null = owner
    ? {
        type: "email",
        key: owner.email ?? owner.label ?? "owner",
        label: owner.name ?? owner.label ?? owner.email ?? t("wiki.share_role_owner"),
        secondary: owner.email ?? "",
        image: owner.image,
      }
    : null;
  const activeOptionId =
    isListOpen && candidateRows[activeIndex] ? `${listboxId}-${activeIndex}` : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        onEscapeKeyDown={handleEscapeKeyDown}
        onPointerDownOutside={(event) => {
          if (isMutating) event.preventDefault();
        }}
        className="flex max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-[37.5rem] flex-col gap-0 overflow-hidden rounded-2xl border-border bg-card p-0 text-card-foreground shadow-2xl shadow-black/20 sm:max-h-[calc(100dvh-3rem)] sm:max-w-[37.5rem]"
      >
        <header className="flex items-center gap-2 px-5 pb-3 pt-5 sm:px-6">
          {screen === "grant" && (
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={() => {
                setIsListOpen(false);
                setScreen("overview");
              }}
              className="-ml-2 rounded-full"
              aria-label={t("wiki.share_back")}
            >
              <ChevronLeft size={22} />
            </Button>
          )}
          <DialogTitle className="min-w-0 flex-1 truncate text-xl font-medium tracking-[-0.01em]">
            {t("wiki.share_dialog_title", { title: pageTitle })}
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={close}
            disabled={isMutating}
            className="rounded-full text-muted-foreground"
            aria-label={t("close")}
          >
            <X size={22} />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">
          {canManage ? (
            <div ref={searchAreaRef} className="relative">
              <div
                className={`flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border bg-background px-2 py-1 shadow-sm transition-[border-color,box-shadow] duration-150 ${isListOpen ? "border-ring ring-2 ring-ring/20" : "border-input"}`}
              >
                {selected.map((subject) => (
                  <span
                    key={`${subject.type}:${subject.key}`}
                    className="flex max-w-full items-center gap-1.5 rounded-full border border-border bg-secondary py-0.5 pl-0.5 pr-1.5 text-sm text-secondary-foreground"
                  >
                    <Avatar subject={subject} size="h-8 w-8" />
                    <span className="max-w-48 truncate">{subject.label}</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeSelection(subject)}
                      className="rounded-full"
                      aria-label={t("wiki.share_remove_subject", { name: subject.label })}
                    >
                      <X size={16} />
                    </Button>
                  </span>
                ))}
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setIsListOpen(true);
                    setActiveIndex(0);
                  }}
                  onFocus={() => setIsListOpen(true)}
                  onKeyDown={handleInputKeyDown}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={isListOpen}
                  aria-controls={listboxId}
                  aria-activedescendant={activeOptionId}
                  placeholder={
                    selected.length ? t("wiki.share_add_more") : t("wiki.share_search_placeholder")
                  }
                  className="min-w-44 flex-1 border-0 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <MotionPresence
                present={isListOpen}
                distance={-4}
                className="absolute left-0 right-0 z-10 mt-1"
              >
                <div
                  id={listboxId}
                  role={listboxRole}
                  tabIndex={-1}
                  aria-label={t("wiki.share_search_placeholder")}
                  className="max-h-64 overflow-y-auto rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-xl shadow-black/10"
                >
                  {candidatesFetcher.state !== "idle" && candidateRows.length === 0 ? (
                    <p className="flex items-center gap-2 px-5 py-4 text-sm text-muted-foreground">
                      <Loader2 className="animate-spin motion-reduce:animate-none" size={16} />
                      {t("wiki.share_loading_candidates")}
                    </p>
                  ) : candidateRows.length ? (
                    candidateRows.map((subject, index) => (
                      <Button
                        id={`${listboxId}-${index}`}
                        key={`${subject.type}:${subject.key}`}
                        variant="ghost"
                        size="default"
                        role={optionRole}
                        aria-selected={activeIndex === index}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => chooseCandidate(subject)}
                        className={`h-auto w-full justify-start gap-3 rounded-none px-4 py-2.5 text-left ${activeIndex === index ? "bg-accent" : ""}`}
                      >
                        <Avatar subject={subject} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{subject.label}</span>
                          <span className="block truncate text-sm text-muted-foreground">
                            {subject.secondary}
                          </span>
                        </span>
                        {subject.type === "chapter" && (
                          <UsersRound
                            className="text-muted-foreground"
                            size={18}
                            aria-label={t("wiki.share_chapter")}
                          />
                        )}
                      </Button>
                    ))
                  ) : (
                    <p className="px-5 py-4 text-sm text-muted-foreground">
                      {t("wiki.share_no_candidates")}
                    </p>
                  )}
                </div>
              </MotionPresence>
            </div>
          ) : null}

          <MotionSwap stateKey={screen} distance={6} className="min-h-0">
            {screen === "grant" ? (
              <section className="pt-5" aria-label={t("wiki.share_add_people")}>
                <div className="grid gap-4 sm:grid-cols-[1fr_144px] sm:items-start">
                  <label className="flex min-h-10 items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={notify}
                      onChange={(event) => setNotify(event.target.checked)}
                      className="h-5 w-5 accent-primary"
                    />
                    {t("wiki.share_notify")}
                  </label>
                  <label className="sr-only" htmlFor="grant-role">
                    {t("wiki.share_role")}
                  </label>
                  <Select
                    value={grantRole}
                    onValueChange={(value) => setGrantRole(value as PageRole)}
                  >
                    <SelectTrigger
                      id="grant-role"
                      aria-label={t("wiki.share_role")}
                      className="h-10 w-full rounded-lg bg-background"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {t(`wiki.share_role_${role}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <MotionPresence present={notify} className="mt-5" distance={-4}>
                  <label className="block">
                    <span className="sr-only">{t("wiki.share_message")}</span>
                    <textarea
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      placeholder={t("wiki.share_message")}
                      rows={5}
                      disabled={!notify}
                      className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-2 focus:ring-ring/20"
                    />
                  </label>
                </MotionPresence>
                <MotionPresence present={Boolean(error)} className="mt-3" distance={-3}>
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                </MotionPresence>
                <footer className="mt-6 flex items-center justify-end gap-3">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setIsListOpen(false);
                      setScreen("overview");
                    }}
                    disabled={isMutating}
                    className="text-primary"
                  >
                    {t("cancel")}
                  </Button>
                  <Button
                    onClick={grantSelected}
                    disabled={!selected.length || isMutating}
                    className="rounded-full px-5"
                  >
                    {isMutating ? (
                      <Loader2 size={18} className="animate-spin motion-reduce:animate-none" />
                    ) : notify ? (
                      <Send size={18} />
                    ) : (
                      <Share2 size={18} />
                    )}
                    {notify ? t("wiki.share_send") : t("wiki.share")}
                  </Button>
                </footer>
              </section>
            ) : (
              <>
                <section className="pt-5">
                  <h3 className="mb-3 text-base">{t("wiki.share_people_with_access")}</h3>
                  {isLoading ? (
                    <div className="flex justify-center py-6">
                      <Loader2 className="animate-spin text-muted-foreground motion-reduce:animate-none" />
                    </div>
                  ) : (
                    <ul className="space-y-3">
                      {ownerSubject && (
                        <li className="flex items-center gap-3">
                          <Avatar subject={ownerSubject} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-base">{ownerSubject.label}</p>
                            {ownerSubject.secondary && (
                              <p className="truncate text-sm text-muted-foreground">
                                {ownerSubject.secondary}
                              </p>
                            )}
                          </div>
                          <span className="text-base text-muted-foreground">
                            {t("wiki.share_role_owner")}
                          </span>
                        </li>
                      )}
                      {accessList.map((entry) => (
                        <li key={entry.id} className="flex items-center gap-3">
                          <Avatar subject={entry} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-base">{entry.label}</p>
                            <p className="truncate text-sm text-muted-foreground">
                              {entry.secondary}
                            </p>
                          </div>
                          {canManage ? (
                            <>
                              <label className="sr-only" htmlFor={`role-${entry.id}`}>
                                {t("wiki.share_role")}
                              </label>
                              <Select
                                value={entry.role}
                                disabled={isMutating}
                                onValueChange={(value) => changeAccess(entry, value)}
                              >
                                <SelectTrigger
                                  id={`role-${entry.id}`}
                                  aria-label={t("wiki.share_role")}
                                  size="sm"
                                  className="max-w-36 rounded-lg bg-background"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent position="popper" align="end">
                                  {ROLES.map((role) => (
                                    <SelectItem key={role} value={role}>
                                      {t(`wiki.share_role_${role}`)}
                                    </SelectItem>
                                  ))}
                                  <SelectSeparator />
                                  {accessFetcher.data?.myRole === "owner" &&
                                    entry.type === "email" &&
                                    entry.userId && (
                                      <SelectItem value="transfer">
                                        {t("wiki.share_transfer")}
                                      </SelectItem>
                                    )}
                                  <SelectItem value="remove" className="text-destructive">
                                    {t("wiki.share_remove")}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {t(`wiki.share_role_${entry.role}`)}
                            </span>
                          )}
                        </li>
                      ))}
                      {!ownerSubject && accessList.length === 0 && (
                        <li className="text-sm text-muted-foreground">
                          {t("wiki.share_no_access")}
                        </li>
                      )}
                    </ul>
                  )}
                </section>

                {canManage && (
                  <section className="mt-6">
                    <h3 className="mb-3 text-base">{t("wiki.share_general_access")}</h3>
                    <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-sm">
                        <AccessIcon value={localAccess} />
                      </span>
                      <label className="sr-only" htmlFor="general-access">
                        {t("wiki.share_general_access")}
                      </label>
                      <div className="min-w-0 flex-1">
                        <div className="inline-flex max-w-full items-center">
                          <Select
                            value={localAccess}
                            disabled={isMutating}
                            onValueChange={(value) => setGeneralAccess(value as GeneralAccess)}
                          >
                            <SelectTrigger
                              id="general-access"
                              aria-label={t("wiki.share_general_access")}
                              className="h-9 max-w-full border-0 bg-transparent px-2 shadow-none hover:bg-accent"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper" align="start">
                              {GENERAL_ACCESS.map(({ value, icon: Icon }) => (
                                <SelectItem key={value} value={value}>
                                  <Icon aria-hidden="true" />
                                  {t(`wiki.share_access_${value}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t(`wiki.share_access_${localAccess}_desc`)}
                        </p>
                      </div>
                      {localAccess !== "restricted" && (
                        <div className="ml-auto shrink-0">
                          <label htmlFor="general-role" className="sr-only">
                            {t("wiki.share_link_role")}
                          </label>
                          <Select
                            value={localGeneralRole}
                            disabled={isMutating}
                            onValueChange={(value) =>
                              setGeneralAccess(localAccess, value as PageRole)
                            }
                          >
                            <SelectTrigger
                              id="general-role"
                              aria-label={t("wiki.share_link_role")}
                              className="h-9 rounded-lg border-0 bg-transparent shadow-none hover:bg-accent"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper" align="end">
                              {ROLES.map((role) => (
                                <SelectItem key={role} value={role}>
                                  {t(`wiki.share_role_${role}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </section>
                )}
                <MotionPresence present={Boolean(error || warning)} className="mt-4" distance={-3}>
                  <p role={error ? "alert" : "status"} className="text-sm text-destructive">
                    {error ?? warning}
                  </p>
                </MotionPresence>
                <footer className="mt-6 flex items-center justify-between border-t border-border pt-4">
                  <Button
                    variant="outline"
                    onClick={copyLink}
                    className="rounded-full text-primary"
                  >
                    <MotionSwap
                      as="span"
                      stateKey={copied ? "copied" : "copy"}
                      distance={0}
                      enterDuration={140}
                      className="inline-flex items-center gap-2"
                    >
                      {copied ? <Check size={20} /> : <Copy size={20} />}
                      {copied ? t("wiki.share_copied") : t("wiki.share_copy_link")}
                    </MotionSwap>
                  </Button>
                  <Button onClick={close} disabled={isMutating} className="rounded-full px-5">
                    {t("wiki.share_done")}
                  </Button>
                </footer>
              </>
            )}
          </MotionSwap>
        </div>
      </DialogContent>
    </Dialog>
  );
}
