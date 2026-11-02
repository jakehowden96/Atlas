import "./app.css";
import { mount } from "svelte";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App.svelte";
import { effectiveTheme, revealWindow, windowBackground } from "./lib/theme";

const app = mount(App, {
  target: document.getElementById("app")!,
});

// The window starts hidden. Show it after first paint with a matching background; the timer
// is the safety net for a throttled rAF or any failure on the first attempt.
let shown = false;
async function reveal() {
  if (shown) return;
  let theme: "light" | "dark" = "dark";
  try {
    theme = effectiveTheme(
      localStorage.getItem("atlas-theme"),
      matchMedia("(prefers-color-scheme: dark)").matches,
    );
  } catch {}
  shown = await revealWindow(getCurrentWindow, windowBackground[theme]);
}
requestAnimationFrame(reveal);
setTimeout(reveal, 1500);

export default app;
