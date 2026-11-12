/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  build: {
    /* The default 500 kB warning is about download time over a network. Atlas
       ships its bundle inside the app and loads it off local disk, so chunks
       over that line cost nothing to fetch. Lazy-loading the editor and
       terminal would mean dynamic imports through session-actions,
       terminal-session and CodeEditor for no measurable gain here. */
    chunkSizeWarningLimit: 1300,
    /* Vendor libraries in their own chunks keep `index` under the limit
       without dynamic imports; everything still loads at startup. */
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            /* Core only: language packs stay in their own lazy chunks. */
            {
              name: "codemirror",
              test: /node_modules[\\/](@codemirror[\\/](state|view|language|commands|search|autocomplete|lint)|@lezer[\\/](common|highlight|lr))[\\/]/,
            },
            { name: "xterm", test: /node_modules[\\/]@xterm[\\/]/ },
          ],
        },
      },
    },
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
  /* Svelte 5 resolves its server build under node unless told otherwise;
     component tests need the client runtime for `mount`. */
  resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
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
