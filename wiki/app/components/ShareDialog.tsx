import {
  Check,
  ChevronDown,
  ChevronLeft,
  Copy,
  Globe2,
  Link2,
  Loader2,
  LockKeyhole,
  Send,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

type PageRole = "viewer" | "commenter" | "editor";
type GeneralAccess = "restricted" | "unlisted" | "public";
type SubjectType = "email" | "chapter";

interface ShareSubject {
  type: SubjectType;
  key: string;
  label: string;
  secondary: string;
  image?: string | null;
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
      <img src={subject.image} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchAreaRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
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

  // Keep the last focused control while the closed dialog remains mounted.
  // React may move focus to <body> between the trigger click and this dialog's
  // open effect, so capturing only after `open` changes is too late.
  useEffect(() => {
    if (open) return;
    const rememberFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) triggerRef.current = event.target;
    };
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      triggerRef.current = document.activeElement;
    }
    document.addEventListener("focusin", rememberFocus);
    return () => document.removeEventListener("focusin", rememberFocus);
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher functions are stable
  useEffect(() => {
    if (!open) return;
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      triggerRef.current = document.activeElement;
    }
    setScreen("overview");
    setQuery("");
    setSelected([]);
    setError(null);
    setWarning(null);
    setLocalAccess(currentVisibility as GeneralAccess);
    accessFetcher.load(`/api/page-access/${pageId}`);
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => triggerRef.current?.focus();
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
    const returnTarget = triggerRef.current;
    onClose();
    window.requestAnimationFrame(() => returnTarget?.focus());
  }

  function chooseCandidate(subject: ShareSubject) {
    setSelected((items) => [...items, subject]);
    setQuery("");
    setIsListOpen(false);
    setActiveIndex(0);
    setScreen("grant");
    window.setTimeout(() => inputRef.current?.focus(), 0);
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

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (isListOpen) setIsListOpen(false);
      else if (screen === "grant") setScreen("overview");
      else close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
    );
    if (!focusable?.length) return;
    const targets = Array.from(focusable);
    const first = targets[0];
    const last = targets[targets.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <dialog
        ref={dialogRef}
        open
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        onKeyDown={handleDialogKeyDown}
        className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white text-gray-900 shadow-xl sm:max-h-[calc(100dvh-3rem)]"
      >
        <header className="flex items-center gap-2 px-5 pb-3 pt-5 sm:px-6">
          {screen === "grant" && (
            <button
              type="button"
              onClick={() => {
                setIsListOpen(false);
                setScreen("overview");
              }}
              className="-ml-2 rounded-full p-2 hover:bg-gray-100"
              aria-label={t("wiki.share_back")}
            >
              <ChevronLeft size={26} />
            </button>
          )}
          <h2 id="share-dialog-title" className="min-w-0 flex-1 truncate text-xl font-normal">
            {t("wiki.share_dialog_title", { title: pageTitle })}
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={isMutating}
            className="rounded-full p-2 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            aria-label={t("close")}
          >
            <X size={24} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">
          {canManage ? (
            <div ref={searchAreaRef} className="relative">
              <div
                className={`flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1 transition ${isListOpen ? "border-blue-600 ring-1 ring-blue-600" : "border-gray-300"}`}
              >
                {selected.map((subject) => (
                  <span
                    key={`${subject.type}:${subject.key}`}
                    className="flex max-w-full items-center gap-1.5 rounded-full border border-gray-300 bg-gray-50 py-0.5 pl-0.5 pr-2 text-sm text-gray-700"
                  >
                    <Avatar subject={subject} size="h-8 w-8" />
                    <span className="max-w-48 truncate">{subject.label}</span>
                    <button
                      type="button"
                      onClick={() => removeSelection(subject)}
                      className="rounded-full p-0.5 hover:bg-gray-200"
                      aria-label={t("wiki.share_remove_subject", { name: subject.label })}
                    >
                      <X size={18} />
                    </button>
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
                  className="min-w-44 flex-1 border-0 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-gray-500"
                />
              </div>
              {isListOpen && (
                <div
                  id={listboxId}
                  role={listboxRole}
                  tabIndex={-1}
                  aria-label={t("wiki.share_search_placeholder")}
                  className="absolute left-0 right-0 z-10 max-h-64 overflow-y-auto rounded-b-md border border-t-0 border-gray-200 bg-blue-50 py-1 shadow-lg"
                >
                  {candidatesFetcher.state !== "idle" && candidateRows.length === 0 ? (
                    <p className="flex items-center gap-2 px-5 py-4 text-sm text-gray-600">
                      <Loader2 className="animate-spin" size={16} />
                      {t("wiki.share_loading_candidates")}
                    </p>
                  ) : candidateRows.length ? (
                    candidateRows.map((subject, index) => (
                      <button
                        id={`${listboxId}-${index}`}
                        key={`${subject.type}:${subject.key}`}
                        type="button"
                        role={optionRole}
                        aria-selected={activeIndex === index}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => chooseCandidate(subject)}
                        className={`flex w-full items-center gap-3 px-4 py-2 text-left ${activeIndex === index ? "bg-blue-100" : "hover:bg-blue-50"}`}
                      >
                        <Avatar subject={subject} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{subject.label}</span>
                          <span className="block truncate text-sm text-gray-600">
                            {subject.secondary}
                          </span>
                        </span>
                        {subject.type === "chapter" && (
                          <UsersRound
                            className="text-gray-500"
                            size={18}
                            aria-label={t("wiki.share_chapter")}
                          />
                        )}
                      </button>
                    ))
                  ) : (
                    <p className="px-5 py-4 text-sm text-gray-600">
                      {t("wiki.share_no_candidates")}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {screen === "grant" ? (
            <section className="pt-5" aria-label={t("wiki.share_add_people")}>
              <div className="grid gap-4 sm:grid-cols-[1fr_144px] sm:items-start">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={notify}
                    onChange={(event) => setNotify(event.target.checked)}
                    className="h-5 w-5 accent-[#1a73e8]"
                  />
                  {t("wiki.share_notify")}
                </label>
                <label className="sr-only" htmlFor="grant-role">
                  {t("wiki.share_role")}
                </label>
                <select
                  id="grant-role"
                  value={grantRole}
                  onChange={(event) => setGrantRole(event.target.value as PageRole)}
                  className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {t(`wiki.share_role_${role}`)}
                    </option>
                  ))}
                </select>
              </div>
              <label className="mt-5 block">
                <span className="sr-only">{t("wiki.share_message")}</span>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={t("wiki.share_message")}
                  rows={5}
                  className="w-full resize-none rounded-md border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
              </label>
              {error && (
                <p role="alert" className="mt-3 text-sm text-red-700">
                  {error}
                </p>
              )}
              <footer className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsListOpen(false);
                    setScreen("overview");
                  }}
                  disabled={isMutating}
                  className="px-3 py-2 text-sm text-[#1a73e8] hover:underline disabled:opacity-50"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={grantSelected}
                  disabled={!selected.length || isMutating}
                  className="inline-flex items-center gap-2 rounded-full bg-[#0b57d0] px-5 py-2 text-sm text-white hover:bg-[#0842a0] disabled:opacity-50"
                >
                  {isMutating ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                  {t("wiki.share_send")}
                </button>
              </footer>
            </section>
          ) : (
            <>
              <section className="pt-5">
                <h3 className="mb-3 text-base">{t("wiki.share_people_with_access")}</h3>
                {isLoading ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="animate-spin text-gray-500" />
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {ownerSubject && (
                      <li className="flex items-center gap-3">
                        <Avatar subject={ownerSubject} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base">{ownerSubject.label}</p>
                          {ownerSubject.secondary && (
                            <p className="truncate text-sm text-gray-600">
                              {ownerSubject.secondary}
                            </p>
                          )}
                        </div>
                        <span className="text-base text-gray-500">
                          {t("wiki.share_role_owner")}
                        </span>
                      </li>
                    )}
                    {accessList.map((entry) => (
                      <li key={entry.id} className="flex items-center gap-3">
                        <Avatar subject={entry} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base">{entry.label}</p>
                          <p className="truncate text-sm text-gray-600">{entry.secondary}</p>
                        </div>
                        {canManage ? (
                          <>
                            <label className="sr-only" htmlFor={`role-${entry.id}`}>
                              {t("wiki.share_role")}
                            </label>
                            <select
                              id={`role-${entry.id}`}
                              value={entry.role}
                              disabled={isMutating}
                              onChange={(event) =>
                                updateRole(entry.id, event.target.value as PageRole)
                              }
                              className="max-w-36 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
                            >
                              <option value="viewer">{t("wiki.share_role_viewer")}</option>
                              <option value="commenter">{t("wiki.share_role_commenter")}</option>
                              <option value="editor">{t("wiki.share_role_editor")}</option>
                            </select>
                            <button
                              type="button"
                              onClick={() => removeAccess(entry.id)}
                              disabled={isMutating}
                              className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-red-700"
                              aria-label={t("wiki.share_remove_subject", { name: entry.label })}
                            >
                              <Trash2 size={18} />
                            </button>
                          </>
                        ) : (
                          <span className="text-sm text-gray-500">
                            {t(`wiki.share_role_${entry.role}`)}
                          </span>
                        )}
                      </li>
                    ))}
                    {!ownerSubject && accessList.length === 0 && (
                      <li className="text-sm text-gray-600">{t("wiki.share_no_access")}</li>
                    )}
                  </ul>
                )}
              </section>

              {canManage && (
                <section className="mt-6">
                  <h3 className="mb-3 text-base">{t("wiki.share_general_access")}</h3>
                  <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-700">
                      <AccessIcon value={localAccess} />
                    </span>
                    <label className="sr-only" htmlFor="general-access">
                      {t("wiki.share_general_access")}
                    </label>
                    <div className="min-w-0 flex-1">
                      <div className="relative inline-flex max-w-full items-center">
                        <select
                          id="general-access"
                          value={localAccess}
                          disabled={isMutating}
                          onChange={(event) =>
                            setGeneralAccess(event.target.value as GeneralAccess)
                          }
                          className="max-w-full appearance-none bg-transparent py-1 pr-7 text-sm outline-none"
                        >
                          <option value="restricted">{t("wiki.share_access_restricted")}</option>
                          <option value="unlisted">{t("wiki.share_access_unlisted")}</option>
                          <option value="public">{t("wiki.share_access_public")}</option>
                        </select>
                        <ChevronDown
                          className="pointer-events-none absolute right-0 text-gray-600"
                          size={18}
                        />
                      </div>
                      <p className="mt-1 text-sm text-gray-600">
                        {t(`wiki.share_access_${localAccess}_desc`)}
                      </p>
                    </div>
                    {localAccess !== "restricted" && (
                      <div className="relative ml-auto shrink-0">
                        <label htmlFor="general-role" className="sr-only">
                          {t("wiki.share_link_role")}
                        </label>
                        <select
                          id="general-role"
                          value={localGeneralRole}
                          disabled={isMutating}
                          onChange={(event) =>
                            setGeneralAccess(localAccess, event.target.value as PageRole)
                          }
                          className="appearance-none rounded-md bg-transparent py-2 pl-3 pr-8 text-sm outline-none hover:bg-gray-50"
                        >
                          <option value="viewer">{t("wiki.share_role_viewer")}</option>
                          <option value="commenter">{t("wiki.share_role_commenter")}</option>
                          <option value="editor">{t("wiki.share_role_editor")}</option>
                        </select>
                        <ChevronDown
                          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-600"
                          size={18}
                        />
                      </div>
                    )}
                  </div>
                </section>
              )}
              {(error || warning) && (
                <p
                  role={error ? "alert" : "status"}
                  className={`mt-4 text-sm ${error ? "text-red-700" : "text-amber-700"}`}
                >
                  {error ?? warning}
                </p>
              )}
              <footer className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4">
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-300 px-4 py-2 text-sm text-blue-700 hover:bg-blue-50"
                >
                  {copied ? <Check size={20} /> : <Copy size={20} />}
                  {copied ? t("wiki.share_copied") : t("wiki.share_copy_link")}
                </button>
                <button
                  type="button"
                  onClick={close}
                  disabled={isMutating}
                  className="rounded-full bg-[#0b57d0] px-5 py-2 text-sm text-white hover:bg-[#0842a0] disabled:opacity-50"
                >
                  {t("wiki.share_done")}
                </button>
              </footer>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
