import { describe, it, expect } from "vitest";
import { theme, xtermTheme, mermaidThemeVariables } from "../theme";

describe("theme", () => {
  it("has all required base colors", () => {
    expect(theme.surface).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.onSurface).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.red).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.green).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.blue).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.yellow).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.cyan).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("has distinct colors for document tabs vs awaiting tabs", () => {
    // cyan (document tabs) must differ from yellow (needs-input tabs)
    expect(theme.cyan).not.toBe(theme.yellow);
  });
});

describe("xtermTheme", () => {
  it("derives all colors from the shared palette", () => {
    expect(xtermTheme.background).toBe(theme.surface);
    expect(xtermTheme.foreground).toBe(theme.onSurfaceVariant);
    expect(xtermTheme.red).toBe(theme.red);
    expect(xtermTheme.green).toBe(theme.green);
    expect(xtermTheme.blue).toBe(theme.blue);
  });
});

describe("mermaidThemeVariables", () => {
  it("derives colors from the shared palette", () => {
    expect(mermaidThemeVariables.primaryColor).toBe(theme.primary);
    expect(mermaidThemeVariables.background).toBe(theme.surface);
    expect(mermaidThemeVariables.darkMode).toBe(true);
  });
});
