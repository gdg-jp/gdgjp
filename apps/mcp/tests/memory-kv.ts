/** In-memory KVNamespace with the subset workers-oauth-provider uses (get / put / delete / list). */
export function memoryKv(): KVNamespace {
  const store = new Map<string, { value: string; metadata?: unknown }>();
  const kv = {
    async get(key: string, options?: unknown) {
      const entry = store.get(key);
      if (!entry) return null;
      const type = typeof options === "string" ? options : (options as { type?: string })?.type;
      return type === "json" ? JSON.parse(entry.value) : entry.value;
    },
    async put(key: string, value: string, options?: { metadata?: unknown }) {
      store.set(key, { value, metadata: options?.metadata });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
      const names = [...store.keys()]
        .filter((name) => name.startsWith(options.prefix ?? ""))
        .sort();
      const start = options.cursor ? Number(options.cursor) : 0;
      const limit = options.limit ?? 1000;
      const page = names.slice(start, start + limit);
      const complete = start + limit >= names.length;
      return {
        keys: page.map((name) => ({ name, metadata: store.get(name)?.metadata })),
        list_complete: complete,
        ...(complete ? {} : { cursor: String(start + limit) }),
        cacheStatus: null,
      };
    },
  };
  return kv as unknown as KVNamespace;
}
