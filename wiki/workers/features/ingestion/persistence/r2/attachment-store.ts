export interface IngestionAttachment {
  key: string;
  mimeType: string;
  size: number;
}

export interface AttachmentUpload {
  key: string;
  body: ArrayBuffer | ArrayBufferView | ReadableStream;
  mimeType: string;
}

export interface AttachmentStore {
  put(upload: AttachmentUpload): Promise<IngestionAttachment>;
  head(key: string): Promise<IngestionAttachment | null>;
  get(key: string): Promise<R2ObjectBody | null>;
}

/** R2 adapter for uploads handled by the presentation boundary. */
export class R2AttachmentStore implements AttachmentStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(upload: AttachmentUpload): Promise<IngestionAttachment> {
    await this.bucket.put(upload.key, upload.body, {
      httpMetadata: { contentType: upload.mimeType },
    });
    const attachment = await this.head(upload.key);
    if (!attachment) throw new Error("Uploaded attachment could not be read from R2");
    return attachment;
  }

  async head(key: string): Promise<IngestionAttachment | null> {
    const object = await this.bucket.head(key);
    if (!object) return null;
    return {
      key,
      mimeType: object.httpMetadata?.contentType ?? "application/octet-stream",
      size: object.size,
    };
  }

  get(key: string): Promise<R2ObjectBody | null> {
    return this.bucket.get(key);
  }
}
