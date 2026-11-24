import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BOMBADIL = {
  version: "0.8.0",
  assets: {
    "darwin-arm64": {
      name: "bombadil-aarch64-darwin",
      sha256: "2ea26a68ac9b5296a8828ff138fb17a3343f7e8cf50647e9d1a81074505f995c",
    },
    "linux-x64": {
      name: "bombadil-x86_64-linux",
      sha256: "d9d1d2832cb23c874744a4f20526d2064ce8571c31f8ecd01ddf8e1c44da4814",
    },
    "linux-arm64": {
      name: "bombadil-aarch64-linux",
      sha256: "8ac5e26b609296ec7017480220baf310617b9a799352c6fd5e723b2a30d246d3",
    },
  },
};

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function hostArch() {
  if (process.platform !== "darwin" || process.arch !== "x64") return process.arch;
  const translated = spawnSync("sysctl", ["-n", "sysctl.proc_translated"], { encoding: "utf8" });
  return translated.stdout?.trim() === "1" ? "arm64" : process.arch;
}

export function bombadilAsset(platform = process.platform, arch = hostArch()) {
  const asset = BOMBADIL.assets[`${platform}-${arch}`];
  if (!asset) throw new Error(`Bombadil ${BOMBADIL.version} has no binary for ${platform}-${arch}`);
  return {
    ...asset,
    url: `https://github.com/antithesishq/bombadil/releases/download/v${BOMBADIL.version}/${asset.name}`,
  };
}

export async function ensureBombadil(root = repository) {
  const asset = bombadilAsset();
  const override = process.env.BOMBADIL_BIN;
  const binary = override ?? join(root, "local_data/pstack/tools", `bombadil-${BOMBADIL.version}`);
  if (existsSync(binary)) {
    if (sha256(await readFile(binary)) === asset.sha256) return binary;
    if (override) throw new Error(`BOMBADIL_BIN is not Bombadil ${BOMBADIL.version}: ${binary}`);
  } else if (override) {
    throw new Error(`BOMBADIL_BIN does not exist: ${binary}`);
  }
  const response = await fetch(asset.url);
  if (!response.ok)
    throw new Error(
      `Could not download Bombadil ${BOMBADIL.version} (${response.status}). Set BOMBADIL_BIN to a local copy.`,
    );
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== asset.sha256)
    throw new Error(`Downloaded Bombadil has SHA-256 ${digest}, expected ${asset.sha256}`);
  await mkdir(dirname(binary), { recursive: true });
  await writeFile(`${binary}.partial`, bytes);
  chmodSync(`${binary}.partial`, 0o755);
  await rename(`${binary}.partial`, binary);
  return binary;
}

export function parseBombadilOutput(output) {
  const violations = [...output.matchAll(/^(\w+) was violated:/gm)].map((match) => match[1]);
  const reproduce = /Reproduce this test using:\s*\n\s*(.+)/.exec(output)?.[1]?.trim() ?? null;
  const inspect = /Inspect the test results using:\s*\n\s*(.+)/.exec(output)?.[1]?.trim() ?? null;
  return { violations: [...new Set(violations)], reproduce, inspect };
}

export function bombadilFailure({ origin, output, exitCode, trace }) {
  const parsed = parseBombadilOutput(output);
  const names = parsed.violations.length ? parsed.violations : ["unknown"];
  const signature = createHash("sha256")
    .update(`bombadil\n${new URL(origin).hostname}\n${names.join(",")}`)
    .digest("hex")
    .slice(0, 16);
  const excerpt = output.slice(Math.max(0, output.indexOf(" was violated:") - 200)).slice(0, 4000);
  return {
    kind: "bombadil-violation",
    engine: `bombadil ${BOMBADIL.version}`,
    property: `bombadil default properties on ${new URL(origin).hostname}`,
    title: names.join(", "),
    target: origin,
    seed: null,
    signature,
    exitCode,
    violation: { kind: "monitor", name: names.join(", "), message: excerpt },
    trace,
    commands: { seed: null, minimal: parsed.reproduce, inspect: parsed.inspect },
    minimal: [],
    steps: [],
  };
}

function run(binary, args) {
  return new Promise((done) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        output += chunk;
        process.stdout.write(chunk);
      });
    child.on("close", (code) => done({ exitCode: code ?? 1, output }));
    child.on("error", (error) => done({ exitCode: 1, output: `${output}\n${error.message}` }));
  });
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === "ensure") {
    console.log(await ensureBombadil());
    return 0;
  }
  if (command !== "explore")
    throw new Error(
      "Usage: node packages/ui-properties/scripts/bombadil.mjs ensure | explore <origin> [--time-limit 5m] [--out DIR] [--cookie SET-COOKIE] [--allow-url PATTERN]",
    );
  const origin = rest[0];
  if (!origin?.startsWith("http")) throw new Error("explore needs an http(s) origin");
  const option = (name, fallback) => {
    const index = rest.indexOf(`--${name}`);
    return index >= 0 ? rest[index + 1] : fallback;
  };
  const many = (name) =>
    rest.flatMap((value, index) => (rest[index - 1] === `--${name}` ? [value] : []));
  const out = resolve(option("out", join(repository, "local_data/pstack/ui-properties/bombadil")));
  mkdirSync(out, { recursive: true });
  const trace = join(out, `${new URL(origin).hostname}.bin`);
  const headers = [];
  if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET)
    headers.push(
      "--header",
      `CF-Access-Client-Id=${process.env.CF_ACCESS_CLIENT_ID}`,
      "--header",
      `CF-Access-Client-Secret=${process.env.CF_ACCESS_CLIENT_SECRET}`,
    );
  const cookies = [];
  const cookieFile = process.env.BOMBADIL_COOKIE_FILE;
  if (cookieFile)
    for (const line of readFileSync(cookieFile, "utf8").split("\n").filter(Boolean))
      cookies.push("--cookie", line);
  const binary = await ensureBombadil();
  const { exitCode, output } = await run(binary, [
    "browser",
    "test",
    "--headless",
    "--exit-on-violation",
    "--time-limit",
    option("time-limit", "5m"),
    "--output-path",
    trace,
    "--output-path-overwrite",
    ...headers,
    ...cookies,
    ...many("cookie").flatMap((value) => ["--cookie", value]),
    ...many("allow-url").flatMap((value) => ["--allow-url", value]),
    origin,
  ]);
  if (exitCode === 2) {
    const failure = bombadilFailure({ origin, output, exitCode, trace });
    const directory = process.env.UI_PROPERTY_FAILURES_DIR ?? out;
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, `${failure.signature}-bombadil.json`),
      JSON.stringify(failure, null, 2),
    );
    console.error(
      `Bombadil found ${failure.title} on ${origin}; Bombadil has no seed, replay the trace with: ${failure.commands.minimal}`,
    );
  }
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
