import type { StorybookConfig } from "@storybook/react-vite";
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx", "../src/**/*.mdx"],
  addons: ["@storybook/addon-docs"],
  framework: "@storybook/react-vite",
  core: { disableTelemetry: true },
  viteFinal: async (viteConfig) => ({
    ...viteConfig,
    resolve: {
      ...viteConfig.resolve,
      dedupe: Array.from(new Set(["react", "react-dom", ...(viteConfig.resolve?.dedupe ?? [])])),
    },
  }),
};
export default config;
