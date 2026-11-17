import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import { createShareKeyboardHandlers } from "./keyboard";
import { copyText, isEmail, normalizeCandidate, normalizeEntry } from "./normalize";
import type {
  AccessData,
  CandidateData,
  GeneralAccess,
  PageRole,
  ShareDialogProps,
  ShareSubject,
} from "./types";
import { useDescendantSync } from "./use-descendant-sync";
import { useHeightTransition } from "./use-height-transition";

export function useShareDialog({
  open,
  onClose,
  pageId,
  pageTitle,
  currentVisibility = "restricted",
  canManageAccess = false,
}: ShareDialogProps) {
  const { t } = useTranslation("common");
  const accessFetcher = useFetcher<AccessData>();
  const candidatesFetcher = useFetcher<CandidateData>();
  const { load: loadAccess, reset: resetAccess } = accessFetcher;
  const { load: loadCandidates, reset: resetCandidates } = candidatesFetcher;
  const mutationFetcher = useFetcher<{
    ok?: boolean;
    error?: string;
    warning?: string;
    notificationFailures?: number;
  }>();
  const { promptDescendantSync, resetDescendantPrompt, ...descendants } = useDescendantSync(pageId);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchAreaRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
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
  const [hasSuccessfulPermissionChange, setHasSuccessfulPermissionChange] = useState(false);
  const searchInputHeight = useHeightTransition();
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
  useEffect(() => {
    if (!open) return;
    setScreen("overview");
    setQuery("");
    setIsListOpen(false);
    setSelected([]);
    setError(null);
    setWarning(null);
    setHasSuccessfulPermissionChange(false);
    resetDescendantPrompt();
    loadAccess(`/api/page-access/${pageId}`);
    return () => {
      resetAccess();
      resetCandidates();
    };
  }, [open, pageId, loadAccess, resetAccess, resetCandidates, resetDescendantPrompt]);
  useEffect(() => {
    if (!open || !accessFetcher.data) return;
    setLocalAccess(
      accessFetcher.data.generalAccess ?? accessFetcher.data.visibility ?? "restricted",
    );
    setLocalGeneralRole(accessFetcher.data.generalRole ?? "viewer");
  }, [accessFetcher.data, open]);

  useEffect(() => {
    resetCandidates();
    if (!open || !isListOpen) return;
    const timer = window.setTimeout(() => {
      loadCandidates(
        `/api/share-candidates?pageId=${encodeURIComponent(pageId)}&q=${encodeURIComponent(query)}`,
      );
    }, 160);
    return () => {
      window.clearTimeout(timer);
      resetCandidates();
    };
  }, [open, isListOpen, query, pageId, loadCandidates, resetCandidates]);

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

  useEffect(() => {
    if (!open) {
      processedMutation.current = mutationFetcher.data;
      return;
    }
    if (mutationFetcher.state !== "idle" || !mutationFetcher.data) return;
    if (processedMutation.current === mutationFetcher.data) return;
    processedMutation.current = mutationFetcher.data;
    if (mutationFetcher.data.error) {
      setError(t("wiki.share_error_generic", { defaultValue: mutationFetcher.data.error }));
      return;
    }
    setError(null);
    setHasSuccessfulPermissionChange(true);
    setWarning(
      mutationFetcher.data.warning ??
        ("notificationFailures" in mutationFetcher.data && mutationFetcher.data.notificationFailures
          ? t("wiki.share_notification_warning")
          : null),
    );
    loadAccess(`/api/page-access/${pageId}`);
    if (screen === "grant") {
      setSelected([]);
      setQuery("");
      setMessage("");
      setScreen("overview");
    }
  }, [mutationFetcher.state, mutationFetcher.data, pageId, screen, t, open, loadAccess]);

  function close() {
    if (isMutating) return;
    if (hasSuccessfulPermissionChange) promptDescendantSync(accessFetcher.data);
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

  function syncWithParent() {
    submitMutation({ intent: "syncWithParent" });
  }

  async function copyLink() {
    try {
      await copyText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(t("wiki.share_copy_failed"));
    }
  }

  const { handleInputKeyDown, handleEscapeKeyDown } = createShareKeyboardHandlers({
    isListOpen,
    activeIndex,
    candidateRows,
    screen,
    setIsListOpen,
    setActiveIndex,
    setScreen,
    chooseCandidate,
    close,
  });

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
  return {
    t,
    accessFetcher,
    candidatesFetcher,
    ...descendants,
    inputRef,
    searchAreaRef,
    restoreFocusRef,
    listboxId,
    screen,
    setScreen,
    query,
    setQuery,
    isListOpen,
    setIsListOpen,
    activeIndex,
    setActiveIndex,
    selected,
    grantRole,
    setGrantRole,
    notify,
    setNotify,
    message,
    setMessage,
    copied,
    error,
    warning,
    localAccess,
    localGeneralRole,
    searchInputHeight,
    canManage,
    accessList,
    candidateRows,
    isMutating,
    isLoading,
    close,
    chooseCandidate,
    removeSelection,
    grantSelected,
    changeAccess,
    setGeneralAccess,
    syncWithParent,
    copyLink,
    handleInputKeyDown,
    handleEscapeKeyDown,
    ownerSubject,
    activeOptionId,
  };
}

export type ShareDialogController = ReturnType<typeof useShareDialog>;
