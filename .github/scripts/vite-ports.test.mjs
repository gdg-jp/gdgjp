import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "../..");

function findViteConfigs(dir) {
  const configs = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const configPath = join(fullPath, "vite.config.ts");
      try {
        if (statSync(configPath).isFile()) {
          configs.push({
            app: entry.name,
            path: configPath,
            content: readFileSync(configPath, "utf8"),
          });
        }
      } catch {
        // vite.config.ts does not exist in this directory
      }
    }
  }
  return configs;
}

test("all vite.config.ts define strictPort: true and have unique server ports", () => {
  const configs = findViteConfigs(rootDir);
  assert.ok(configs.length >= 10, `Expected at least 10 vite configs, found ${configs.length}`);

  const ports = new Map();

  for (const { app, content } of configs) {
    const portMatch = content.match(/port:\s*(\d+)/);
    assert.ok(portMatch, `${app} vite.config.ts must define server.port`);

    const port = Number(portMatch[1]);
    const strictPortMatch = /strictPort:\s*true/.test(content);
    assert.ok(strictPortMatch, `${app} vite.config.ts must define strictPort: true`);

    assert.ok(
      !ports.has(port),
      `Port ${port} in ${app} conflicts with port already defined in ${ports.get(port)}`,
    );
    ports.set(port, app);
  }
});
