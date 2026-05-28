import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ["browser"],
  },
  test: {
    environmentMatchGlobs: [
      ["src/lib/__tests__/diff-viewer.test.ts", "jsdom"],
    ],
  },
});
