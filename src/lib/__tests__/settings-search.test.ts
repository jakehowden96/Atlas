// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { writable } from "svelte/store";

const state = vi.hoisted(() => ({ store: null as unknown }));
vi.mock("../updater", async () => {
  const { writable: w } = await import("svelte/store");
  const store = w({ kind: "notConfigured" });
  state.store = store;
  return { updateState: store, checkForUpdate: vi.fn(), installUpdate: vi.fn() };
});
vi.mock("../ipc", () => ({
  claudeInfo: vi.fn().mockResolvedValue({ version: "2.0.0" }),
  claudeCheck: vi.fn(),
  openUrl: vi.fn(),
  startSessionTail: vi.fn(),
  stopSessionTail: vi.fn(),
  stateLoad: vi.fn(),
  stateSave: vi.fn(),
  setClaudeHook: vi.fn(),
}));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn().mockResolvedValue("1.2.3") }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { SETTINGS_INDEX, searchSettings } from "../settings-search";
import About from "../components/settings/sections/About.svelte";
import SettingsModal from "../components/settings/SettingsModal.svelte";
import { settingsOpen } from "../stores/settings";

afterEach(cleanup);

describe("searchSettings", () => {
  it("returns nothing for a blank query", () => {
    expect(searchSettings("  ")).toEqual([]);
  });

  it("ranks title matches above keyword and description matches", () => {
    const r = searchSettings("font");
    expect(r[0]?.title).toBe("Terminal font size");
    const t = searchSettings("dark");
    expect(t[0]?.title).toBe("Appearance"); // keyword hit
  });

  it("requires every word to match", () => {
    expect(searchSettings("font zebra")).toEqual([]);
    expect(searchSettings("terminal size")[0]?.title).toBe("Terminal font size");
  });
});

describe("index completeness", () => {
  it("lists every row title found in the section components", () => {
    const files = import.meta.glob("../components/settings/sections/*.svelte", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const missing: string[] = [];
    for (const src of Object.values(files)) {
      for (const m of src.matchAll(/class="row-title">([^<{]+)</g)) {
        const t = m[1]!.trim();
        if (!SETTINGS_INDEX.some((e) => e.title === t)) missing.push(t);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("About updates", () => {
  const set = (s: unknown) => (state.store as ReturnType<typeof writable>).set(s);

  beforeEach(() => set({ kind: "notConfigured" }));

  it("is honest when updates are not configured", () => {
    render(About, { version: "1.2.3" });
    expect(screen.getByText("Updates aren't configured in this build")).toBeTruthy();
    expect(screen.queryByText("Check now")).toBeNull();
  });

  it("offers check now when up to date", () => {
    set({ kind: "upToDate" });
    render(About, { version: "1.2.3" });
    expect(screen.getByText("Atlas is up to date")).toBeTruthy();
    expect(screen.getByText("Check now")).toBeTruthy();
  });

  it("offers the update when one is available", () => {
    set({ kind: "available", version: "2.0.0", notes: "", date: "" });
    render(About, { version: "1.2.3" });
    expect(screen.getByText("Update to 2.0.0")).toBeTruthy();
  });
});

describe("SettingsModal", () => {
  beforeEach(() => settingsOpen.set(true));

  it("groups the nav and switches sections by arrow key", async () => {
    render(SettingsModal);
    expect(screen.getByText("Work")).toBeTruthy();
    expect(screen.getByText("App")).toBeTruthy();
    const general = await screen.findByRole("tab", { name: "General" });
    general.focus();
    await fireEvent.keyDown(general, { key: "ArrowDown" });
    expect(screen.getByRole("tab", { name: "Keyboard" }).getAttribute("aria-selected")).toBe("true");
  });

  it("jumps from a search result to its section", async () => {
    render(SettingsModal);
    const box = await screen.findByLabelText("Search settings");
    await fireEvent.input(box, { target: { value: "check automatically" } });
    await fireEvent.click(await screen.findByText("Check automatically"));
    expect(screen.getByRole("tab", { name: "About" }).getAttribute("aria-selected")).toBe("true");
  });
});
