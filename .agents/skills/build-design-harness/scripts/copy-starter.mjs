import assert from 'node:assert/strict';
import { cpSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [destination, ...extra] = process.argv.slice(2);
assert(destination && !extra.length, 'Usage: node copy-starter.mjs NEW_DIRECTORY');
const target = resolve(destination);
// Refuse existing destinations, including empty ones; never overwrite a project.
mkdirSync(target);
cpSync(new URL('../assets/harness-starter/', import.meta.url), target, { recursive: true });
copyFileSync(new URL('../assets/token-pipeline/generate-tokens.mjs', import.meta.url), resolve(target, 'generate-tokens.mjs'));
console.log(`Created ${target}. Run npm ci, npm run design:generate, and npm test there.`);
