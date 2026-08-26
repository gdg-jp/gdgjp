import { customAlphabet } from "nanoid";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const generate = customAlphabet(ALPHABET, 8);

export async function generateUniqueImageId(db: D1Database, maxAttempts = 5): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const id = generate();
    const row = await db.prepare("SELECT id FROM images WHERE id = ?").bind(id).first();
    if (!row) return id;
  }
  throw new Error("failed to allocate unique image id");
}

export function isValidImageId(id: string): boolean {
  return /^[0-9A-Za-z]{8}$/.test(id);
}
