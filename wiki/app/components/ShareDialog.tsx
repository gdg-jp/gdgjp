import { Check, Copy, Link, Loader2, Minus, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import type { PageAccessEntry, PageRole } from "~/lib/page-access.server";

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  pageId: string;
  pageTitle: string;
  currentVisibility: string;
  canManageAccess: boolean;
  canChangeVisibility: boolean;
}

interface AccessData {
  accessList: PageAccessEntry[];
  myRole: PageRole | null;
  canChangeVisibility: boolean;
  visibility: string;
}

interface SearchUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

interface SearchData {
  users: SearchUser[];
}

interface PendingUser {
  email: string;
  userId?: string;
  name?: string;
  image?: string;
}

const ROLE_OPTIONS: PageRole[] = ["owner", "editor", "viewer"];

const VISIBILITY_OPTIONS = [
  { value: "restricted", labelKey: "wiki.visibility_restricted" },
  { value: "public", labelKey: "wiki.visibility_public" },
  { value: "private_to_chapter", labelKey: "wiki.visibility_chapter" },
  { value: "private_to_lead", labelKey: "wiki.visibility_lead" },
] as const;

function initials(nameOrEmail: string) {
  return nameOrEmail.charAt(0).toUpperCase();
}

function Avatar({
  image,
  name,
  size = 8,
}: {
  image?: string | null;
  name: string;
  size?: number;
}) {
  const cls = `h-${size} w-${size} rounded-full`;
  if (image) {
    return <img src={image} alt={name} className={`${cls} object-cover`} />;
  }
  return (
    <span
      className={`flex ${cls} shrink-0 items-center justify-center bg-gray-200 text-xs font-medium text-gray-600`}
    >
      {initials(name)}
    </span>
  );
}

export default function ShareDialog({
  open,
  onClose,
  pageId,
  pageTitle,
  currentVisibility,
  canManageAccess,
  canChangeVisibility,
}: ShareDialogProps) {
  const { t } = useTranslation("common");
  const dataFetcher = useFetcher<AccessData>();
  const mutateFetcher = useFetcher();
  const searchFetcher = useFetcher<SearchData>();

  // Add-people state
  const [query, setQuery] = useState("");
  const [pendingUser, setPendingUser] = useState<PendingUser | null>(null);
  const [addRole, setAddRole] = useState<PageRole>("viewer");
  const [showDropdown, setShowDropdown] = useState(false);

  const [copied, setCopied] = useState(false);
  const [localVisibility, setLocalVisibility] = useState(currentVisibility);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load access list when dialog opens
  // biome-ignore lint/correctness/useExhaustiveDependencies: dataFetcher.load is stable
  useEffect(() => {
    if (!open) return;
    setLocalVisibility(currentVisibility);
    if (canManageAccess) {
      dataFetcher.load(`/api/page-access/${pageId}`);
    }
  }, [open, pageId, currentVisibility, canManageAccess]);

  // Update local visibility when data loads
  useEffect(() => {
    if (dataFetcher.data) {
      setLocalVisibility(dataFetcher.data.visibility);
    }
  }, [dataFetcher.data]);

  // Reload after mutations
  // biome-ignore lint/correctness/useExhaustiveDependencies: dataFetcher.load and t are stable
  useEffect(() => {
    if (mutateFetcher.state === "idle" && mutateFetcher.data) {
      const d = mutateFetcher.data as { ok?: boolean; error?: string };
      if (d.error) {
        setErrorMsg(t(`wiki.share_error_${d.error}`, { defaultValue: d.error }));
      } else {
        setErrorMsg(null);
        setPendingUser(null);
        setQuery("");
        if (canManageAccess) {
          dataFetcher.load(`/api/page-access/${pageId}`);
        }
      }
    }
  }, [mutateFetcher.state, mutateFetcher.data, pageId, canManageAccess]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Debounced search
  // biome-ignore lint/correctness/useExhaustiveDependencies: searchFetcher.load is stable
  useEffect(() => {
    if (pendingUser || !query) {
      setShowDropdown(false);
      return;
    }
    const timer = setTimeout(() => {
      searchFetcher.load(`/api/users/search?q=${encodeURIComponent(query)}`);
      setShowDropdown(true);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, pendingUser]);

  // Click-outside to close dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!open) return null;

  const accessList = dataFetcher.data?.accessList ?? [];
  const myRole = dataFetcher.data?.myRole ?? null;
  const effectiveCanChangeVisibility = dataFetcher.data?.canChangeVisibility ?? canChangeVisibility;
  const isLoading = dataFetcher.state !== "idle";

  function canGrantRole(targetRole: PageRole): boolean {
    if (!canManageAccess) return false;
    if (myRole === "owner") return true;
    if (myRole === "editor") return targetRole !== "owner";
    return false;
  }

  const grantableRoles = ROLE_OPTIONS.filter((r) => canGrantRole(r));

  function handleAdd(email: string, role: PageRole) {
    setErrorMsg(null);
    mutateFetcher.submit(JSON.stringify({ intent: "add", email, pageRole: role }), {
      method: "post",
      action: `/api/page-access/${pageId}`,
      encType: "application/json",
    });
  }

  function handleUpdateRole(accessId: string, pageRole: PageRole) {
    mutateFetcher.submit(JSON.stringify({ intent: "update", accessId, pageRole }), {
      method: "post",
      action: `/api/page-access/${pageId}`,
      encType: "application/json",
    });
  }

  function handleRemove(accessId: string) {
    setErrorMsg(null);
    mutateFetcher.submit(JSON.stringify({ intent: "remove", accessId }), {
      method: "post",
      action: `/api/page-access/${pageId}`,
      encType: "application/json",
    });
  }

  function handleVisibilityChange(visibility: string) {
    setLocalVisibility(visibility);
    mutateFetcher.submit(JSON.stringify({ intent: "setVisibility", visibility }), {
      method: "post",
      action: `/api/page-access/${pageId}`,
      encType: "application/json",
    });
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function clearPending() {
    setPendingUser(null);
    setQuery("");
    setShowDropdown(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function pickCandidate(user: SearchUser) {
    setPendingUser({
      email: user.email,
      userId: user.id,
      name: user.name,
      image: user.image ?? undefined,
    });
    setQuery("");
    setShowDropdown(false);
  }

  function pickUnregistered(email: string) {
    setPendingUser({ email });
    setQuery("");
    setShowDropdown(false);
  }

  const searchResults: SearchUser[] = searchFetcher.data?.users ?? [];
  const isValidEmail = query.includes("@");
  const emailInResults = searchResults.some((u) => u.email.toLowerCase() === query.toLowerCase());
  const showUnregisteredRow = isValidEmail && !emailInResults;

  const dropdownVisible = showDropdown && query.length > 0;

  return (
    /* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop handled; Escape via window keydown */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation */}
      <dialog
        open
        onClick={(e) => e.stopPropagation()}
        className="relative m-4 w-full max-w-lg rounded-xl bg-white p-0 shadow-xl"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 id="share-dialog-title" className="text-base font-semibold text-gray-900">
            {t("wiki.share_dialog_title", { title: pageTitle })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label={t("close")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* Add people */}
          {canManageAccess && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {t("wiki.share_add_people")}
              </p>

              {pendingUser ? (
                /* Chip + role + action buttons */
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {/* Chip */}
                    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-2 py-1.5">
                      <Avatar
                        image={pendingUser.image}
                        name={pendingUser.name ?? pendingUser.email}
                        size={6}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                        {pendingUser.name ?? pendingUser.email}
                      </span>
                      {pendingUser.name && (
                        <span className="shrink-0 truncate text-xs text-gray-400">
                          {pendingUser.email}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={clearPending}
                        className="ml-1 shrink-0 rounded p-0.5 text-gray-400 hover:bg-blue-100 hover:text-gray-600"
                        aria-label={t("wiki.share_chip_remove_aria")}
                      >
                        <X size={13} />
                      </button>
                    </div>
                    {/* Role dropdown */}
                    <select
                      value={addRole}
                      onChange={(e) => setAddRole(e.target.value as PageRole)}
                      className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700"
                    >
                      {grantableRoles.map((r) => (
                        <option key={r} value={r}>
                          {t(`wiki.share_role_${r}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={clearPending}
                      className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAdd(pendingUser.email, addRole)}
                      disabled={mutateFetcher.state !== "idle"}
                      className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      <UserPlus size={14} />
                      {t("wiki.share_add_button")}
                    </button>
                  </div>
                </div>
              ) : (
                /* Search input + dropdown */
                <div ref={dropdownRef} className="relative">
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (searchResults.length === 1) {
                          pickCandidate(searchResults[0]);
                        } else if (searchResults.length === 0 && showUnregisteredRow) {
                          pickUnregistered(query);
                        }
                      } else if (e.key === "Escape") {
                        setShowDropdown(false);
                      }
                    }}
                    placeholder={t("wiki.share_search_placeholder")}
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />

                  {dropdownVisible && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
                      {searchResults.map((u) => (
                        /* biome-ignore lint/a11y/useKeyWithClickEvents: mouse-driven dropdown */
                        <div
                          key={u.id}
                          onClick={() => pickCandidate(u)}
                          className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50"
                        >
                          <Avatar image={u.image} name={u.name} size={8} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-gray-800">{u.name}</p>
                            <p className="truncate text-xs text-gray-400">{u.email}</p>
                          </div>
                        </div>
                      ))}
                      {showUnregisteredRow && (
                        /* biome-ignore lint/a11y/useKeyWithClickEvents: mouse-driven dropdown */
                        <div
                          onClick={() => pickUnregistered(query)}
                          className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-500">
                            ?
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-gray-800">{query}</p>
                            <p className="text-xs text-gray-400">{t("wiki.share_unregistered")}</p>
                          </div>
                        </div>
                      )}
                      {searchResults.length === 0 && !showUnregisteredRow && (
                        <div className="px-3 py-2 text-sm text-gray-400">
                          {searchFetcher.state !== "idle" ? (
                            <Loader2 size={14} className="inline animate-spin" />
                          ) : (
                            t("wiki.share_no_access")
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {errorMsg && <p className="mt-1.5 text-xs text-red-600">{errorMsg}</p>}
            </div>
          )}

          {/* People with access */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {t("wiki.share_people_with_access")}
            </p>
            {isLoading && accessList.length === 0 ? (
              <div className="flex justify-center py-4">
                <Loader2 size={18} className="animate-spin text-gray-400" />
              </div>
            ) : accessList.length === 0 ? (
              <p className="text-sm text-gray-400">{t("wiki.share_no_access")}</p>
            ) : (
              <ul className="space-y-2">
                {accessList.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3">
                    {/* Avatar */}
                    {entry.userImage ? (
                      <img
                        src={entry.userImage}
                        alt={entry.userName ?? entry.email}
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600">
                        {(entry.userName ?? entry.email).charAt(0).toUpperCase()}
                      </span>
                    )}
                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      {entry.userName ? (
                        <>
                          <p className="truncate text-sm font-medium text-gray-800">
                            {entry.userName}
                          </p>
                          <p className="truncate text-xs text-gray-400">{entry.email}</p>
                        </>
                      ) : (
                        <>
                          <p className="truncate text-sm text-gray-800">{entry.email}</p>
                          <p className="text-xs text-gray-400">{t("wiki.share_pending")}</p>
                        </>
                      )}
                    </div>
                    {/* Role dropdown */}
                    {canManageAccess && canGrantRole(entry.pageRole as PageRole) ? (
                      <select
                        value={entry.pageRole}
                        onChange={(e) => handleUpdateRole(entry.id, e.target.value as PageRole)}
                        className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
                      >
                        {ROLE_OPTIONS.filter((r) => canGrantRole(r)).map((r) => (
                          <option key={r} value={r}>
                            {t(`wiki.share_role_${r}`)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-gray-500">
                        {t(`wiki.share_role_${entry.pageRole}`)}
                      </span>
                    )}
                    {/* Remove */}
                    {canManageAccess && (
                      <button
                        type="button"
                        onClick={() => handleRemove(entry.id)}
                        className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        aria-label={t("wiki.share_remove")}
                      >
                        <Minus size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* General access */}
          {effectiveCanChangeVisibility && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {t("wiki.share_general_access")}
              </p>
              <select
                value={localVisibility}
                onChange={(e) => handleVisibilityChange(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
              >
                {VISIBILITY_OPTIONS.map(({ value, labelKey }) => (
                  <option key={value} value={value}>
                    {t(labelKey)}
                  </option>
                ))}
              </select>
              {localVisibility === "restricted" && (
                <p className="mt-1 text-xs text-gray-500">
                  {t("wiki.share_general_restricted_desc")}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            {copied ? (
              <>
                <Check size={14} className="text-green-600" />
                {t("wiki.share_copied")}
              </>
            ) : (
              <>
                <Link size={14} />
                {t("wiki.share_copy_link")}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            {t("close")}
          </button>
        </div>
      </dialog>
    </div>
  );
}
