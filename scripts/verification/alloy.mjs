import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const ALLOY = {
  version: "6.2.0",
  url: "https://github.com/AlloyTools/org.alloytools.alloy/releases/download/v6.2.0/org.alloytools.alloy.dist.jar",
  sha256: "6b8c1cb5bc93bedfc7c61435c4e1ab6e688a242dc702a394628d9a9801edb78d",
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function javaVersion() {
  const result = spawnSync("java", ["-version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(
      "Alloy needs a Java runtime on PATH. `java -version` did not run. Verified with Temurin 21.",
    );
  }
  return (result.stderr || result.stdout).split("\n")[0].trim();
}

export async function ensureAlloy(root) {
  const override = process.env.ALLOY_JAR;
  const jar = override ?? join(root, "local_data/pstack/tools", `alloy-${ALLOY.version}.jar`);
  if (existsSync(jar)) {
    if (sha256(await readFile(jar)) === ALLOY.sha256) return jar;
    if (override) throw new Error(`ALLOY_JAR is not Alloy ${ALLOY.version}: ${jar}`);
  } else if (override) {
    throw new Error(`ALLOY_JAR does not exist: ${jar}`);
  }
  const response = await fetch(ALLOY.url);
  if (!response.ok) {
    throw new Error(
      `Could not download Alloy ${ALLOY.version} (${response.status}). Set ALLOY_JAR to a local copy.`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== ALLOY.sha256) {
    throw new Error(`Downloaded Alloy has SHA-256 ${digest}, expected ${ALLOY.sha256}`);
  }
  await mkdir(dirname(jar), { recursive: true });
  await writeFile(`${jar}.partial`, bytes);
  await rename(`${jar}.partial`, jar);
  return jar;
}

const bare = (atom) => atom.replaceAll("$", "");

function normalizeState(instance) {
  const state = {};
  for (const [atom, fields] of Object.entries(instance.values)) {
    state[bare(atom)] = Object.fromEntries(
      Object.entries(fields).map(([field, tuples]) => [field, tuples.map((t) => t.map(bare))]),
    );
  }
  for (const [atom, fields] of Object.entries(state)) {
    for (const [field, tuples] of Object.entries(fields)) {
      for (const name of tuples.flat()) {
        if (!(name in state)) {
          throw new Error(
            `Alloy receipt names ${name} in ${atom}.${field} without listing it. Give every signature an exact scope.`,
          );
        }
      }
    }
  }
  return state;
}

export function runAlloy({ jar, model, output, command }) {
  const args = ["-jar", jar, "exec", "-f", "-q", "-o", output];
  if (command) args.push("-c", command);
  args.push(model);
  return new Promise((resolve, reject) => {
    const child = spawn("java", args, { stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (chunk) => {
      log += chunk;
    });
    child.stderr.on("data", (chunk) => {
      log += chunk;
    });
    child.on("error", reject);
    child.on("close", async (status) => {
      if (status !== 0) {
        reject(new Error(`Alloy exited with ${status} for ${model}\n${log.slice(0, 4000)}`));
        return;
      }
      try {
        const receipt = JSON.parse(await readFile(join(output, "receipt.json"), "utf8"));
        resolve(
          Object.fromEntries(
            Object.entries(receipt.commands).map(([name, entry]) => {
              const solution = entry.solution?.[0];
              return [
                name,
                {
                  name,
                  type: entry.type,
                  source: entry.source.replace(/\s+/g, " "),
                  satisfiable: Boolean(solution),
                  states: solution ? solution.instances.map(normalizeState) : [],
                },
              ];
            }),
          ),
        );
      } catch (error) {
        reject(error);
      }
    });
  });
}
