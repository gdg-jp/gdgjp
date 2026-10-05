import type { FilePart } from "ai";
import type { IngestionInputs } from "../../../../shared/ingestion/domain";

export interface AttachmentObjectStore {
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
  } | null>;
}

/** Loads only bounded, referenced R2 objects. The returned bytes never enter
 * an Agent State, realtime event, or Workflow payload. */
export async function loadIngestionAttachmentParts(
  store: AttachmentObjectStore,
  inputs: IngestionInputs,
): Promise<FilePart[]> {
  const parts: FilePart[] = [];
  for (const key of [...inputs.imageKeys, ...(inputs.pdfKeys ?? [])].slice(0, 12)) {
    const object = await store.get(key);
    if (!object) continue;
    parts.push({
      type: "file",
      data: new Uint8Array(await object.arrayBuffer()),
      mediaType:
        object.httpMetadata?.contentType ??
        (key.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream"),
      filename: key.split("/").at(-1),
    });
  }
  return parts;
}
