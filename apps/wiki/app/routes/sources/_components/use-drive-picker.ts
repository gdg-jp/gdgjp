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

/**
 * The add-source panel's Google Drive button: opens the Picker and stages each picked Docs /
 * Sheets / Slides file — or folder, which becomes one source holding every such file beneath
 * it under the folder's own paths — as a candidate.
 */
export function useDrivePicker({
  addCandidates,
  onNeedsConnection,
}: {
  addCandidates: (next: StagedSource[]) => boolean;
  onNeedsConnection: () => void;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function stagePicked(documents: GooglePickerDocument[]) {
    const candidates = documents.flatMap((document) => toCandidate(document) ?? []);
    if (candidates.length === 0) {
      setError(t("sources.error_unsupported_document"));
    } else if (addCandidates(candidates)) {
      setError(t("sources.error_duplicate_source"));
    }
  }

  async function open() {
    setError(null);
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
          if (data.action === picker.Action.PICKED) stagePicked(data.docs ?? []);
          setLoading(false);
        })
        .build()
        .setVisible(true);
    } catch {
      setError(t("sources.error_picker"));
      setLoading(false);
    }
  }

  return { open, loading, error };
}
