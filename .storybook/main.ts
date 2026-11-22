import type { StorybookConfig } from "@storybook/svelte-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(svelte|ts)"],
  addons: ["@storybook/addon-svelte-csf", "@storybook/addon-themes", "@storybook/addon-a11y"],
  framework: { name: "@storybook/svelte-vite", options: {} },
  core: { disableTelemetry: true },
};
export default config;
