/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  build: {
    /* The default 500 kB warning is about download time over a network. Atlas
       ships its bundle inside the app and loads it off local disk, so the one
       chunk over that line (xterm plus the CodeMirror core, ~870 kB) costs
       nothing to fetch. Raised rather than code-split: splitting the editor and
       terminal out would mean dynamic imports through session-actions,
       terminal-session and CodeEditor for no measurable gain here. */
    chunkSizeWarningLimit: 1000,
  },
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
