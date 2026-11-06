import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The Playbook is bundled from the gdg-jp/skills submodule. A build without it would ship
 * a pr app with no rules, so fail instead of falling back to an empty playbook.
 */
function playbookVersion(): string {
  try {
    return execFileSync("git", ["-C", `${repoRoot}/skills`, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    throw new Error(
      "skills submodule is missing: run `git submodule update --init skills` (the pr app bundles skills/pr-playbook)",
    );
  }
}

/**
 * `pnpm dev` (and e2e) talk to local stand-ins for sns and tinyurl's PrService. Set
 * PR_REAL_SERVICES=1 to resolve SNS / TINYURL / CONNPASS through the dev registry to real dev servers.
 */
const mockServices = (command: string) =>
  command === "serve" && !process.env.PR_REAL_SERVICES
    ? [
        { configPath: "./e2e/mock-services/sns.wrangler.toml" },
        { configPath: "./e2e/mock-services/tinyurl.wrangler.toml" },
        { configPath: "./e2e/mock-services/connpass.wrangler.toml" },
      ]
    : [];

export default defineConfig(({ command }) => ({
  build: { reportCompressedSize: false, target: ["edge88", "firefox78", "chrome87", "safari14"] },
  define: { __PLAYBOOK_VERSION__: JSON.stringify(playbookVersion()) },
  server: { port: 5191, strictPort: true, fs: { allow: [repoRoot] } },
  plugins: [
    cloudflare({
      configPath: process.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH,
      viteEnvironment: { name: "ssr" },
      remoteBindings: false,
      inspectorPort: process.env.CI ? false : 9291,
      auxiliaryWorkers: mockServices(command),
    }),
    reactRouter(),
    tailwindcss(),
  ],
  // `@gdgjp/gdg-lib` is consumed as source; dedupe React so hydration sees one
  // copy (same block as ost/roster/mc/screen/roulette).
  resolve: { tsconfigPaths: true, dedupe: ["react", "react-dom", "react-router"] },
  // Pre-bundle the linked UI package before requests arrive (same as accounts).
  // Discovering its dependencies on the first page load re-optimizes and
  // reloads the page mid-hydration.
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react-router",
      "radix-ui",
      "lucide-react",
      "@gdgjp/design-system",
    ],
  },
  // Pre-bundling is a dev-only concern. A partial SSR environment in a build
  // makes React Router 7 replace Cloudflare's Worker entry with its server build.
  environments:
    command === "serve"
      ? { ssr: { optimizeDeps: { include: ["@gdgjp/design-system"] } } }
      : undefined,
}));
