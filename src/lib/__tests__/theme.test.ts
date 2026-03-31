import { describe, it, expect } from "vitest";
import { theme, xtermTheme, mermaidThemeVariables } from "../theme";

describe("theme", () => {
  it("has all required base colors", () => {
    expect(theme.bg).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.fg).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.red).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.green).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.blue).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.yellow).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("xtermTheme", () => {
  it("derives all colors from the shared palette", () => {
    expect(xtermTheme.background).toBe(theme.bg);
    expect(xtermTheme.foreground).toBe(theme.fg);
    expect(xtermTheme.red).toBe(theme.red);
    expect(xtermTheme.green).toBe(theme.green);
    expect(xtermTheme.blue).toBe(theme.blue);
  });
});

describe("mermaidThemeVariables", () => {
  it("derives colors from the shared palette", () => {
    expect(mermaidThemeVariables.primaryColor).toBe(theme.blue);
    expect(mermaidThemeVariables.background).toBe(theme.bg);
    expect(mermaidThemeVariables.darkMode).toBe(true);
  });
});
