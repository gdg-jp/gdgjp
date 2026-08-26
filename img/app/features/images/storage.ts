export async function putOriginal(
  env: Env,
  key: string,
  bytes: ArrayBuffer | ReadableStream,
  meta: { contentType: string; userId: string; chapterId: number; filename: string | null },
): Promise<void> {
  await env.ORIGINALS.put(key, bytes, {
    httpMetadata: { contentType: meta.contentType },
    customMetadata: {
      userId: meta.userId,
      chapterId: String(meta.chapterId),
      filename: meta.filename ?? "",
    },
  });
}

export async function deleteOriginal(env: Env, key: string): Promise<void> {
  await env.ORIGINALS.delete(key);
}
