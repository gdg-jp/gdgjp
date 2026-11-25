import { defineConfig } from "vitest/config";

const exclude = ["node_modules/**", ".next/**", ".open-next/**"];

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    server: { deps: { inline: ["next-auth"] } },
    projects: [
      {
        extends: true,
        test: { name: "node", environment: "node", include: ["**/*.test.ts"], exclude },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "happy-dom",
          include: ["**/*.test.tsx"],
          exclude,
          execArgv: ["--no-experimental-webstorage"],
        },
      },
    ],
  },
});
