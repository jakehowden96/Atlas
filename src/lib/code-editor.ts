/**
 * CodeMirror setup for the Files screen's source pane.
 *
 * The pane was a plain textarea: "Files shows all directories under the current
 * workspace but does not show code files. Update files to be able to view code
 * files and edit them similar to VS Code."
 *
 * Two things are deliberately not hardcoded here. Highlighting comes from
 * `@codemirror/language-data`, which matches the filename itself and loads the
 * grammar on demand, so a language is one dependency rather than one import per
 * language. Colours come from the CSS custom properties in `app.css` via
 * `var()`, so the editor follows the theme — including the 7:1 body floor —
 * without a second palette to keep in step.
 */
import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorView } from "@codemirror/view";

/** The grammar for a filename, or null when no packaged language matches. */
export async function languageSupportFor(path: string): Promise<LanguageSupport | null> {
  const name = path.split(/[\\/]/).pop() ?? path;
  const desc = LanguageDescription.matchFilename(languages, name);
  if (!desc) return null;
  try {
    return await desc.load();
  } catch {
    // A grammar that fails to load leaves the file editable as plain text,
    // which is better than an empty pane.
    return null;
  }
}

/**
 * The editor's own styling, entirely in theme tokens.
 *
 * `--t-*` are the transcript ink roles, which already carry the terminal's
 * contrast floor, so the highlighting sits at the same readability as the
 * session panes rather than inventing a third palette.
 */
export const atlasEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--term-bg)",
    color: "var(--term-text)",
    fontSize: "var(--fs-sm)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.6",
  },
  ".cm-content": { caretColor: "var(--accent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--term-bg)",
    color: "var(--muted)",
    border: "none",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--text) 4%, transparent)" },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--text)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 12px" },
  ".cm-foldPlaceholder": {
    background: "var(--surface3)",
    border: "none",
    color: "var(--muted)",
  },
  ".cm-tooltip": {
    border: "1px solid var(--border2)",
    borderRadius: "var(--r-md)",
    background: "var(--surface)",
    color: "var(--text)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--fs-xs)",
  },
  ".cm-tooltip .cm-tooltip-arrow:before": { borderTopColor: "var(--border2)" },
  ".cm-tooltip .cm-tooltip-arrow:after": { borderTopColor: "var(--surface)" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    background: "var(--accent)",
    color: "var(--accent-ink)",
  },
  ".cm-panels": {
    background: "var(--surface2)",
    color: "var(--text)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--fs-xs)",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--warn) 35%, transparent)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "color-mix(in srgb, var(--accent) 45%, transparent)",
  },
  ".cm-lintRange-error": { backgroundImage: "none", borderBottom: "2px solid var(--danger)" },
  ".cm-lintRange-warning": { backgroundImage: "none", borderBottom: "2px solid var(--warn)" },
});
