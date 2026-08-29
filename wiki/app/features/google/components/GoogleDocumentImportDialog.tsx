import { FileText, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { loadGooglePicker } from "~/features/google/picker.client";
import type { GooglePickerConfig } from "~/features/google/picker.client";

interface ImportPreview {
  documentTitle: string;
  createCount: number;
  updateCount: number;
  archiveCount: number;
  pages?: Array<{ title: string; action: "create" | "update" | "archive"; depth: number }>;
}

export default function GoogleDocumentImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<GooglePickerConfig | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [needsConnection, setNeedsConnection] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedForOpen = useRef(false);

  function reset() {
    setConfig(null);
    setPreview(null);
    setDocumentId(null);
    setSelectedName(null);
    setLoading(false);
    setSubmitting(false);
    setNeedsConnection(false);
    setError(null);
    loadedForOpen.current = false;
  }

  useEffect(() => {
    if (!open || loadedForOpen.current) return;
    loadedForOpen.current = true;
    let cancelled = false;
    setLoading(true);
    fetch("/api/google-documents/picker-token", { credentials: "same-origin" })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as
          | GooglePickerConfig
          | { connected?: boolean }
          | null;
        if (!response.ok || !data || !("accessToken" in data)) {
          if (
            response.status === 401 ||
            response.status === 403 ||
            response.status === 409 ||
            (data !== null && "connected" in data && data.connected === false)
          ) {
            setNeedsConnection(true);
            return;
          }
          throw new Error("Unable to prepare Google Drive");
        }
        if (!cancelled) setConfig(data);
      })
      .catch(() => !cancelled && setError(t("googleDocumentImport.errors.connection")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  async function chooseDocument() {
    if (!config) return;
    setError(null);
    setLoading(true);
    try {
      await loadGooglePicker();
      const picker = window.google?.picker;
      if (!picker) throw new Error("Google Picker unavailable");

      // Picker owns its own modal. Close our Radix modal first so its focus
      // trap and outside-interaction handling never compete with Picker.
      onOpenChange(false);
      const view = new picker.DocsView(picker.ViewId.DOCS);
      view.setMimeTypes("application/vnd.google-apps.document");
      view.setSelectFolderEnabled(false);
      new picker.PickerBuilder()
        .setDeveloperKey(config.apiKey)
        .setAppId(config.appId)
        .setOAuthToken(config.accessToken)
        .addView(view)
        .setCallback((data) => {
          if (data.action === picker.Action.PICKED) {
            const document = data.docs?.[0];
            if (!document) return;
            setDocumentId(document.id);
            setSelectedName(document.name);
            setPreview(null);
            onOpenChange(true);
            void loadPreview(document.id);
          } else if (data.action === picker.Action.CANCEL) {
            setLoading(false);
            onOpenChange(true);
          }
        })
        .build()
        .setVisible(true);
    } catch {
      setError(t("googleDocumentImport.errors.picker"));
      setLoading(false);
      onOpenChange(true);
    }
  }

  async function loadPreview(selectedDocumentId = documentId) {
    if (!selectedDocumentId) return;
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/google-documents/import/preview", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: selectedDocumentId }),
      });
      if (!response.ok) throw new Error("Preview failed");
      setPreview((await response.json()) as ImportPreview);
    } catch {
      setError(t("googleDocumentImport.errors.preview"));
    } finally {
      setLoading(false);
    }
  }

  async function commitImport() {
    if (!documentId) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/google-documents/import", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      const result = (await response.json().catch(() => null)) as {
        jobId?: string;
        error?: string;
      } | null;
      if (response.status !== 202 || !result?.jobId) {
        console.error("[google-document-import] request failed", {
          status: response.status,
          documentId,
          error: result?.error ?? "The API did not return a JSON error response",
        });
        throw new Error("Import failed");
      }
      const storageKey = "gdg-google-document-import-jobs";
      let current: unknown = [];
      try {
        current = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as unknown;
      } catch {
        // A stale/corrupted browser value must not make an accepted import look failed.
      }
      const jobs = Array.isArray(current)
        ? current.filter((value): value is string => typeof value === "string")
        : [];
      if (!jobs.includes(result.jobId))
        localStorage.setItem(storageKey, JSON.stringify([...jobs, result.jobId]));
      window.dispatchEvent(new CustomEvent("google-document-import-enqueued"));
      onOpenChange(false);
      reset();
    } catch {
      setError(t("googleDocumentImport.errors.import"));
    } finally {
      setSubmitting(false);
    }
  }

  function connectGoogleDrive() {
    const returnTo = `${window.location.pathname}?google_document_import=1`;
    window.location.assign(`/api/google-drive/auth?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) reset();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-sm sm:max-w-sm">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>{t("googleDocumentImport.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-6">
          {needsConnection ? (
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
              <p className="text-sm">{t("googleDocumentImport.connect_hint")}</p>
              <Button onClick={connectGoogleDrive}>{t("googleDocumentImport.connect")}</Button>
            </div>
          ) : (
            <>
              <Button variant="outline" onClick={chooseDocument} disabled={loading || !config}>
                {loading ? <LoaderCircle className="animate-spin" /> : <FileText />}
                {t("googleDocumentImport.choose")}
              </Button>
              {selectedName && (
                <div className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-medium">{selectedName}</p>
                  <p className="mt-1 text-muted-foreground">
                    {preview
                      ? t("googleDocumentImport.preview_summary", {
                          create: preview.createCount,
                          update: preview.updateCount,
                          archive: preview.archiveCount,
                        })
                      : t("googleDocumentImport.selected_hint")}
                  </p>
                </div>
              )}
              {preview?.pages && preview.pages.length > 0 && (
                <ul className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-border p-3 text-sm">
                  {preview.pages.map((page) => (
                    <li
                      key={`${page.action}-${page.title}`}
                      className="flex justify-between gap-3"
                      style={{ paddingInlineStart: `${page.depth * 16}px` }}
                    >
                      <span className="truncate">{page.title}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {t(`googleDocumentImport.actions.${page.action}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("cancel")}
          </Button>
          {!needsConnection && preview && (
            <Button onClick={commitImport} disabled={submitting}>
              {submitting && <LoaderCircle className="animate-spin" />}
              {t("googleDocumentImport.import")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
