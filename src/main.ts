import "./app.css";
import { mount } from "svelte";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App.svelte";
import { effectiveTheme, windowBackground } from "./lib/theme";

const app = mount(App, {
  target: document.getElementById("app")!,
});

// The window starts hidden; show it after first paint with a matching background.
requestAnimationFrame(async () => {
  try {
    const win = getCurrentWindow();
    try {
      const theme = effectiveTheme(
        localStorage.getItem("atlas-theme"),
        matchMedia("(prefers-color-scheme: dark)").matches,
      );
      await win.setBackgroundColor(windowBackground[theme]);
    } catch {}
    await win.show();
  } catch {}
});

export default app;
