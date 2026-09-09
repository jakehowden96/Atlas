/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    /* `app.css` is imported with `?raw` by `theme.test.ts`, which asserts the
       real token blocks rather than a copy of them. Vitest stubs CSS imports to
       an empty string by default, query and all. Nothing else in the suite
       imports a stylesheet — every test here is pure logic — so turning this on
       costs one small file. */
    css: true,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.claude/**",
      "**/src-tauri/**",
    ],
  },
});
