# ai

Shared AI-model wrapper over the Vercel AI SDK (`@ai-sdk/google`, Gemini) used by translation,
AI search, and ingestion. Owns model construction and structured-output execution/repair.

- `model/index.server.ts` — the single provider boundary. `createWikiModel` (API key;
  translation + AI search) and `createWikiModelFromEnv` (Worker ingestion) both build one
  `AiSdkWikiModel`.
- `model/structured-output.server.ts` — schema-constrained generation with repair.
