<script lang="ts">
  /**
   * The Files screen's source pane: CodeMirror 6 with highlighting, line
   * numbers, search, and — where a language server is installed — diagnostics,
   * hover and completion.
   *
   * The pane was a plain textarea. "Files shows all directories under the
   * current workspace but does not show code files. Update files to be able to
   * view code files and edit them similar to VS Code."
   *
   * Saving is not this component's business: ⌘S is a global chord that writes
   * whatever `docs` holds, and every keystroke here lands in `docs`. So the
   * editor stays a view over the store rather than a second copy of the text.
   */
  import { autocompletion } from "@codemirror/autocomplete";
  import { languageSupportFor, atlasEditorTheme } from "../../code-editor";
  import { languageIdFor } from "../../code-lang";
  import { clientFor } from "../../lsp-client";
  import { Compartment, EditorState } from "@codemirror/state";
  import { EditorView, keymap } from "@codemirror/view";
  import {
    hoverTooltips,
    languageServerSupport,
    serverCompletionSource,
  } from "@codemirror/lsp-client";
  import { basicSetup } from "codemirror";
  import { onDestroy } from "svelte";
  import { log } from "../../logger";

  interface Props {
    /** Stable identity of the document — a new value rebuilds the editor. */
    docKey: string;
    /** Path relative to `root`, used for both highlighting and the LSP uri. */
    path: string;
    /** Absolute workspace root, which is the language server's project root. */
    root: string;
    /** The text to show. Echoes of this component's own edits are ignored. */
    text: string;
    onChange: (text: string) => void;
  }

  let { docKey, path, root, text, onChange }: Props = $props();

  let host = $state<HTMLDivElement | undefined>();
  let view: EditorView | null = null;
  /** Swapped when the file's language changes, so the editor is built once. */
  const language = new Compartment();
  const lsp = new Compartment();

  /** True while a store update is being applied, so it is not echoed back. */
  let applying = false;

  function create(container: HTMLDivElement, doc: string) {
    return new EditorView({
      parent: container,
      state: EditorState.create({
        doc,
        extensions: [
          basicSetup,
          atlasEditorTheme,
          language.of([]),
          lsp.of([]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || applying) return;
            onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
  }

  /* Build once per document. `docKey` rather than `path` because two workspaces
     can hold the same relative path. */
  $effect(() => {
    const container = host;
    const key = docKey;
    if (!container || !key) return;
    view?.destroy();
    view = create(container, text);
    void attachLanguage(view, path);
    void attachServer(view, path, root);
    return () => {
      view?.destroy();
      view = null;
    };
  });

  /* Text arriving from disk — a reload, or the file changing underneath — is
     pushed in. Guarded by content equality so a keystroke does not round-trip
     through the store and back into the document, which would move the caret. */
  $effect(() => {
    const next = text;
    const current = view;
    if (!current || current.state.doc.toString() === next) return;
    applying = true;
    current.dispatch({
      changes: { from: 0, to: current.state.doc.length, insert: next },
    });
    applying = false;
  });

  async function attachLanguage(target: EditorView, forPath: string) {
    const support = await languageSupportFor(forPath);
    if (!support || target !== view) return;
    target.dispatch({ effects: language.reconfigure(support) });
  }

  /**
   * Wire a language server in if one is installed for this file's language.
   * Absent is the common case and is not an error — the editor keeps
   * highlighting and editing, it just has no diagnostics.
   */
  async function attachServer(target: EditorView, forPath: string, forRoot: string) {
    const languageId = languageIdFor(forPath);
    if (languageId === "plaintext" || !forRoot) return;
    try {
      const client = await clientFor(languageId, forRoot);
      if (!client || target !== view) return;
      const uri = `file://${forRoot.replace(/\/$/, "")}/${forPath}`;
      target.dispatch({
        effects: lsp.reconfigure([
          languageServerSupport(client, uri, languageId),
          hoverTooltips(),
          autocompletion({ override: [serverCompletionSource] }),
          keymap.of([]),
        ]),
      });
      log.info("lsp", `attached ${languageId} to ${forPath}`);
    } catch (e) {
      log.warn("lsp", `could not attach a language server to ${forPath}: ${e}`);
    }
  }

  onDestroy(() => {
    view?.destroy();
    view = null;
  });

  export function focus() {
    view?.focus();
  }

  /** Put the caret on a line, for the outline rail's jumps. */
  export function goToLine(line: number) {
    const current = view;
    if (!current) return;
    const clamped = Math.min(Math.max(1, line + 1), current.state.doc.lines);
    const pos = current.state.doc.line(clamped).from;
    current.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    current.focus();
  }
</script>

<div class="code" bind:this={host}></div>

<style>
  .code {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--term-bg);
  }

  /* CodeMirror sizes itself off its parent, so the host has to be a real box
     rather than the auto height a bare div would take inside the flex row. */
  .code :global(.cm-editor) {
    height: 100%;
  }

  .code :global(.cm-editor.cm-focused) {
    outline: none;
  }
</style>
