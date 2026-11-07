import { useState } from "react";
import { useTranslation } from "react-i18next";
import { loadGooglePicker } from "~/features/google/picker.client";
import type { GooglePickerConfig, GooglePickerDocument } from "~/features/google/picker.client";
import { SOURCE_KINDS } from "~/features/sources/kinds";
import {
  DRIVE_FOLDER_MIME_TYPE,
  SOURCE_MIME_TYPES,
  type StagedSource,
  sourceUrlFromGoogleDocument,
} from "~/features/sources/staged-candidates";

type FolderListing = { files: GooglePickerDocument[]; truncated: boolean };

function toCandidate(document: GooglePickerDocument): StagedSource | null {
  const url = sourceUrlFromGoogleDocument(document);
  if (!url) return null;
  return {
    id: SOURCE_KINDS["google-doc"].candidateId(document.id),
    kind: "google-drive",
    title: document.name,
    url,
  };
}

async function listFolderFiles(folderIds: string[]): Promise<FolderListing | "not_connected"> {
  const params = new URLSearchParams(folderIds.map((id) => ["folderId", id]));
  const response = await fetch(`/api/google-drive/folder-files?${params}`, {
    credentials: "same-origin",
  });
  if (response.status === 401) return "not_connected";
  const body = (await response.json().catch(() => null)) as FolderListing | null;
  if (!response.ok || !body || !Array.isArray(body.files)) {
    throw new Error("folder_list_failed");
  }
  return body;
}

/**
 * The add-source panel's Google Drive button: opens the Picker (files and folders), expands
 * picked folders into every Docs / Sheets / Slides file beneath them, and stages the result.
 * Files already registered in the space are skipped; a folder only reports them when nothing
 * new was left to add.
 */
export function useDrivePicker({
  registeredCandidateIds,
  addCandidates,
  onNeedsConnection,
}: {
  registeredCandidateIds: ReadonlySet<string>;
  addCandidates: (next: StagedSource[]) => boolean;
  onNeedsConnection: () => void;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function stagePicked(documents: GooglePickerDocument[]) {
    const folderIds = documents
      .filter((document) => document.mimeType === DRIVE_FOLDER_MIME_TYPE)
      .map((document) => document.id);
    const picked = documents.filter((document) => document.mimeType !== DRIVE_FOLDER_MIME_TYPE);
    let truncated = false;
    if (folderIds.length > 0) {
      const listing = await listFolderFiles(folderIds);
      if (listing === "not_connected") {
        onNeedsConnection();
        return;
      }
      picked.push(...listing.files);
      truncated = listing.truncated;
    }

    const candidates = picked.flatMap((document) => toCandidate(document) ?? []);
    if (candidates.length === 0) {
      setError(
        t(
          folderIds.length > 0
            ? "sources.error_empty_folder"
            : "sources.error_unsupported_document",
        ),
      );
      return;
    }
    const fresh = candidates.filter((candidate) => !registeredCandidateIds.has(candidate.id));
    if (fresh.length === 0) {
      setError(t("sources.error_duplicate_source"));
      return;
    }
    addCandidates(fresh);
    const skipped = candidates.length - fresh.length;
    const notes = [
      folderIds.length > 0 ? t("sources.folder_staged", { count: fresh.length }) : null,
      skipped > 0 && folderIds.length > 0
        ? t("sources.folder_skipped_registered", { count: skipped })
        : null,
      truncated ? t("sources.folder_truncated") : null,
    ].filter(Boolean);
    if (skipped > 0 && folderIds.length === 0) setError(t("sources.error_duplicate_source"));
    setNotice(notes.length > 0 ? notes.join(" ") : null);
  }

  async function open() {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const response = await fetch("/api/google-documents/picker-token", {
        credentials: "same-origin",
      });
      const config = (await response.json().catch(() => null)) as GooglePickerConfig | null;
      if (!response.ok || !config || !("accessToken" in config)) {
        if (response.status === 401) {
          onNeedsConnection();
          setLoading(false);
          return;
        }
        throw new Error("Unable to prepare Google Drive");
      }

      await loadGooglePicker();
      const picker = window.google?.picker;
      if (!picker) throw new Error("Google Picker unavailable");
      const view = new picker.DocsView(picker.ViewId.DOCS);
      view.setMimeTypes(`${SOURCE_MIME_TYPES},${DRIVE_FOLDER_MIME_TYPE}`);
      view.setIncludeFolders(true);
      view.setSelectFolderEnabled(true);
      new picker.PickerBuilder()
        .setDeveloperKey(config.apiKey)
        .setAppId(config.appId)
        .setOAuthToken(config.accessToken)
        .addView(view)
        .enableFeature(picker.Feature.MULTISELECT_ENABLED)
        .setCallback((data) => {
          if (data.action === picker.Action.PICKED) {
            // Expanding folders is a round trip; keep the button busy until it is staged.
            setLoading(true);
            stagePicked(data.docs ?? [])
              .catch(() => setError(t("sources.error_folder_list")))
              .finally(() => setLoading(false));
          } else {
            setLoading(false);
          }
        })
        .build()
        .setVisible(true);
    } catch {
      setError(t("sources.error_picker"));
      setLoading(false);
    }
  }

  return { open, loading, error, notice };
}
