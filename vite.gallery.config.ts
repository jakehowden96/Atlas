import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Separate from vite.config.ts so the gallery never ships in the Tauri bundle.
export default defineConfig({
  plugins: [svelte()],
  build: { outDir: "dist-gallery", rollupOptions: { input: "gallery.html" } },
  server: { port: 1430, strictPort: true },
});
