import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MotionPresence } from "~/components/ui/motion";
import { isGoogleDriveUrl } from "~/lib/google-drive-utils";

interface InputPanelProps {
  driveConnected: boolean;
  serverError?: string;
}

const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_PDFS = 3;
const MAX_PDF_SIZE = 20 * 1024 * 1024; // 20 MB
const MIN_TEXT_LENGTH = 10;

export default function InputPanel({ driveConnected, serverError }: InputPanelProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [pdfs, setPdfs] = useState<File[]>([]);
  const [docUrl, setDocUrl] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [draggingPdf, setDraggingPdf] = useState(false);

  function validate(): string[] {
    const errs: string[] = [];

    if (docUrl.trim() && !isGoogleDriveUrl(docUrl.trim())) {
      errs.push(t("ingest.errors.invalid_drive_url"));
    }
    if (!docUrl.trim() && pdfs.length === 0 && text.trim().length < MIN_TEXT_LENGTH) {
      errs.push(t("ingest.errors.text_too_short", { min: MIN_TEXT_LENGTH }));
    }
    return errs;
  }

  function handleAddPdfs(files: FileList | File[]) {
    const arr = Array.from(files);
    const current = pdfs.length;
    const errs: string[] = [];

    const valid: File[] = [];
    for (const f of arr) {
      if (current + valid.length >= MAX_PDFS) {
        errs.push(t("ingest.errors.too_many_pdfs", { max: MAX_PDFS }));
        break;
      }
      if (f.size > MAX_PDF_SIZE) {
        errs.push(t("ingest.errors.pdf_too_large", { name: f.name }));
        continue;
      }
      if (f.type !== "application/pdf") {
        errs.push(t("ingest.errors.not_a_pdf", { name: f.name }));
        continue;
      }
      valid.push(f);
    }

    setErrors((prev) => [...prev, ...errs]);
    setPdfs((prev) => [...prev, ...valid]);
  }

  function handleAddImages(files: FileList | File[]) {
    const arr = Array.from(files);
    const current = images.length;
    const errs: string[] = [];

    const valid: File[] = [];
    for (const f of arr) {
      if (current + valid.length >= MAX_IMAGES) {
        errs.push(t("ingest.errors.too_many_images", { max: MAX_IMAGES }));
        break;
      }
      if (f.size > MAX_IMAGE_SIZE) {
        errs.push(t("ingest.errors.image_too_large", { name: f.name }));
        continue;
      }
      if (!f.type.startsWith("image/")) {
        errs.push(t("ingest.errors.not_an_image", { name: f.name }));
        continue;
      }
      valid.push(f);
    }

    setErrors((prev) => [...prev, ...errs]);
    setImages((prev) => [...prev, ...valid]);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const errs = validate();
    if (errs.length > 0) {
      e.preventDefault();
      setErrors(errs);
      return;
    }
    // Sync React state files to the file inputs so the native form submission includes them.
    // This is necessary because drag-and-drop adds files to state only (input.files is not writable
    // directly), and the form would otherwise submit with an empty file input.
    if (fileInputRef.current) {
      const dt = new DataTransfer();
      for (const f of images) dt.items.add(f);
      fileInputRef.current.files = dt.files;
    }
    if (pdfInputRef.current) {
      const dt = new DataTransfer();
      for (const f of pdfs) dt.items.add(f);
      pdfInputRef.current.files = dt.files;
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleAddImages(e.dataTransfer.files);
    }
  }

  function handlePdfDrop(e: React.DragEvent) {
    e.preventDefault();
    setDraggingPdf(false);
    if (e.dataTransfer.files.length > 0) {
      handleAddPdfs(e.dataTransfer.files);
    }
  }

  const allErrors = serverError ? [serverError, ...errors] : errors;

  return (
    <form method="post" encType="multipart/form-data" onSubmit={handleSubmit} className="space-y-6">
      {/* Errors */}
      <MotionPresence present={allErrors.length > 0} distance={-4}>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <ul className="list-disc pl-4 text-sm text-red-700">
            {allErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      </MotionPresence>

      {/* Text input */}
      <div>
        <label htmlFor="ingest-text" className="mb-1.5 block text-sm font-medium text-gray-700">
          {t("ingest.form.text_label")} <span className="text-red-500">*</span>
        </label>
        <textarea
          id="ingest-text"
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={t("ingest.form.text_placeholder")}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <p className="mt-1 text-right text-xs text-gray-400">
          {t("ingest.form.char_count", { count: text.length })}
        </p>
      </div>

      {/* Image upload */}
      <div>
        <p className="mb-1.5 text-sm font-medium text-gray-700">
          {t("ingest.form.images_label", { max: MAX_IMAGES })}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          name="images"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files && handleAddImages(e.target.files)}
        />
        <button
          type="button"
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`w-full cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
            dragging
              ? "border-blue-400 bg-blue-50"
              : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
          }`}
        >
          <p className="text-sm text-gray-500">{t("ingest.form.drop_hint")}</p>
        </button>

        {/* Image previews */}
        {images.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {images.map((img) => (
              <ImagePreview
                key={`${img.name}-${img.size}`}
                img={img}
                onRemove={() => setImages((prev) => prev.filter((f) => f !== img))}
              />
            ))}
          </div>
        )}
      </div>

      {/* PDF upload */}
      <div>
        <p className="mb-1.5 text-sm font-medium text-gray-700">
          {t("ingest.form.pdfs_label", { max: MAX_PDFS })}
        </p>
        <p className="mb-2 text-xs text-gray-400">{t("ingest.form.pdfs_hint")}</p>
        {pdfs.length > 0 && (
          <div className="mb-2 space-y-1.5">
            {pdfs.map((pdf) => (
              <div
                key={`${pdf.name}-${pdf.size}`}
                className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
              >
                <svg
                  className="h-4 w-4 shrink-0 text-red-500"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="flex-1 truncate text-sm text-gray-700">{pdf.name}</span>
                <span className="shrink-0 text-xs text-gray-400">
                  {(pdf.size / 1024 / 1024).toFixed(1)} MB
                </span>
                <button
                  type="button"
                  onClick={() => setPdfs((prev) => prev.filter((f) => f !== pdf))}
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={pdfInputRef}
          type="file"
          name="pdfs"
          multiple
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleAddPdfs(e.target.files);
          }}
        />
        <button
          type="button"
          onDrop={handlePdfDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDraggingPdf(true);
          }}
          onDragLeave={() => setDraggingPdf(false)}
          onClick={() => pdfInputRef.current?.click()}
          className={`w-full cursor-pointer rounded-lg border-2 border-dashed p-4 text-center text-sm transition-colors ${pdfs.length >= MAX_PDFS ? "hidden" : ""} ${
            draggingPdf
              ? "border-blue-400 bg-blue-50 text-blue-500"
              : "border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50"
          }`}
        >
          {t("ingest.form.pdfs_drop_hint")}
        </button>
      </div>

      {/* Google Doc URL */}
      <div>
        <label htmlFor="ingest-doc-url" className="mb-1.5 block text-sm font-medium text-gray-700">
          {t("ingest.form.doc_url_label")}
        </label>
        <div className="flex gap-2">
          <input
            id="ingest-doc-url"
            type="url"
            name="googleDocUrl"
            value={docUrl}
            onChange={(e) => setDocUrl(e.target.value)}
            placeholder="https://docs.google.com/..."
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {driveConnected ? (
            <span className="flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              {t("ingest.form.drive_connected")}
            </span>
          ) : (
            <a
              href="/api/google-drive/auth"
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <GoogleDriveIcon />
              {t("ingest.form.drive_connect")}
            </a>
          )}
        </div>
      </div>

      {/* Submit */}
      <div className="flex justify-end">
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {t("ingest.form.submit")}
        </button>
      </div>
    </form>
  );
}

function ImagePreview({ img, onRemove }: { img: File; onRemove: () => void }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    const objectUrl = URL.createObjectURL(img);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [img]);

  return (
    <div className="relative">
      <img
        src={url}
        alt={img.name}
        className="h-20 w-20 rounded-md object-cover ring-1 ring-gray-200"
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white"
      >
        ×
      </button>
    </div>
  );
}

function GoogleDriveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 87.3 78" aria-hidden="true">
      <path
        d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z"
        fill="#0066da"
      />
      <path
        d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.05a9 9 0 00-1.2 4.5h27.5z"
        fill="#00ac47"
      />
      <path
        d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25a9 9 0 001.2-4.5H60.3l5.85 11.5z"
        fill="#ea4335"
      />
      <path
        d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z"
        fill="#00832d"
      />
      <path
        d="M60.3 52.55H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"
        fill="#2684fc"
      />
      <path
        d="M73.4 26.05l-12.6-21.55C59 3.1 57.85 2 56.5 1.2L43.65 25 60.3 52.55h27.45a9 9 0 00-1.2-4.5z"
        fill="#ffba00"
      />
    </svg>
  );
}
