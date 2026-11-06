import * as schema from "~/db/schema";
import type { getDb } from "~/lib/db.server";
import { type KnowledgeNamespace, knowledgeBinding } from "./binding";
import { KNOWLEDGE_METADATA_FIELDS } from "./shared";

/** Instance configuration shared by every space (one instance per space, id = spaces.id). */
export const INSTANCE_OPTIONS = {
  index_method: { vector: true, keyword: true },
  reranking: true,
  custom_metadata: KNOWLEDGE_METADATA_FIELDS.map((field_name) => ({
    field_name,
    data_type: "text",
  })),
} as const;

async function existingInstanceIds(binding: KnowledgeNamespace): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let page = 1; page < 50; page += 1) {
    const { result } = await binding.list({ page, per_page: 100 });
    for (const instance of result) ids.add(instance.id);
    if (result.length < 100) break;
  }
  return ids;
}

/** Create the space's instance if it does not exist yet. Idempotent. */
export async function ensureSpaceInstance(env: Env, spaceId: string): Promise<boolean> {
  const binding = knowledgeBinding(env);
  if (!binding) return false;
  if ((await existingInstanceIds(binding)).has(spaceId)) return true;
  try {
    await binding.create({ id: spaceId, ...INSTANCE_OPTIONS });
  } catch (error) {
    // A concurrent create wins the race; anything else is a real failure.
    if (!(await existingInstanceIds(binding)).has(spaceId)) throw error;
  }
  return true;
}

/** Spaces without an instance get one (cron). Returns the ids created. */
export async function reconcileSpaceInstances(
  env: Env,
  db: ReturnType<typeof getDb>,
): Promise<string[]> {
  const binding = knowledgeBinding(env);
  if (!binding) return [];
  const existing = await existingInstanceIds(binding);
  const spaces = await db.select({ id: schema.spaces.id }).from(schema.spaces).all();
  const created: string[] = [];
  for (const space of spaces) {
    if (existing.has(space.id)) continue;
    await binding.create({ id: space.id, ...INSTANCE_OPTIONS });
    created.push(space.id);
  }
  return created;
}
