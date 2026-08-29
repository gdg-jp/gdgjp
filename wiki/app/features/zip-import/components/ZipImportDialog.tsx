import { Archive, LoaderCircle, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useRevalidator } from "react-router";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

interface Preview {
  rootTitle: string;
  pageCount: number;
  folderCount: number;
  markdownCount: number;
  csvCount: number;
  imageCount: number;
  skipped: string[];
}

export default function ZipImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setLoading(false);
    setSubmitting(false);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function selectFile(nextFile: File | null) {
    reset();
    if (!nextFile) return;
    setFile(nextFile);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set("file", nextFile);
      const response = await fetch("/api/wiki/import-zip/preview", {
        method: "POST",
        credentials: "same-origin",
        body: formData,
      });
      const result = (await response.json().catch(() => null)) as Preview & { error?: string };
      if (!response.ok) throw new Error(result?.error || "Preview failed");
      setPreview(result);
    } catch (caught) {
      setFile(null);
      setError(caught instanceof Error ? caught.message : t("zipImport.errors.preview"));
    } finally {
      setLoading(false);
    }
  }

  async function importArchive() {
    if (!file) return;
    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/wiki/import-zip", {
        method: "POST",
        credentials: "same-origin",
        body: formData,
      });
      const result = (await response.json().catch(() => null)) as {
        rootSlug?: string;
        error?: string;
      };
      if (!response.ok || !result?.rootSlug) throw new Error(result?.error || "Import failed");
      onOpenChange(false);
      reset();
      revalidator.revalidate();
      navigate(`/wiki/${result.rootSlug}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("zipImport.errors.import"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) reset();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>{t("zipImport.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-6">
          <p className="text-sm text-muted-foreground">{t("zipImport.description")}</p>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            className="sr-only"
            onChange={(event) => void selectFile(event.target.files?.[0] ?? null)}
          />
          <Button
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={loading || submitting}
          >
            {loading ? <LoaderCircle className="animate-spin" /> : <Upload />}
            {file ? t("zipImport.chooseAnother") : t("zipImport.choose")}
          </Button>
          {file && <p className="text-sm font-medium">{file.name}</p>}
          {preview && (
            <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">{preview.rootTitle}</p>
              <p className="text-muted-foreground">
                {t("zipImport.summary", {
                  pages: preview.pageCount,
                  folders: preview.folderCount,
                  markdown: preview.markdownCount,
                  csv: preview.csvCount,
                  images: preview.imageCount,
                })}
              </p>
              {preview.skipped.length > 0 && (
                <p className="text-muted-foreground">
                  {t("zipImport.skipped", { count: preview.skipped.length })}
                </p>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={importArchive} disabled={!preview || submitting}>
            {submitting ? <LoaderCircle className="animate-spin" /> : <Archive />}
            {t("zipImport.import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
