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
  import { pathToFileUri } from "../../files";
  import { clientFor, untrustedRoots } from "../../lsp-client";
  import { setLspTrusted } from "../../stores/settings";
  import { visibleWorkspaces } from "../../stores/workspace";
  import { Compartment, EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import {
    hoverTooltips,
    languageServerSupport,
    serverCompletionSource,
  } from "@codemirror/lsp-client";
  import { basicSetup } from "codemirror";
  import { onDestroy, untrack } from "svelte";
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
    /** True for a file that could not be read. */
    readOnly?: boolean;
    onChange: (text: string) => void;
  }

  let { docKey, path, root, text, readOnly = false, onChange }: Props = $props();

  let host = $state<HTMLDivElement | undefined>();
  let view: EditorView | null = null;
  /** Swapped when the file's language changes, so the editor is built once. */
  const language = new Compartment();
  const lsp = new Compartment();
  const access = new Compartment();

  function accessFor(locked: boolean) {
    return locked ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];
  }

  /** True while a store update is being applied, so it is not echoed back. */
  let applying = false;
  /** The document's text as of the last transaction, so the sync effect can
   *  recognise an echo of its own edit without serialising the document again. */
  let lastEmitted = "";

  function create(container: HTMLDivElement, doc: string) {
    lastEmitted = doc;
    return new EditorView({
      parent: container,
      state: EditorState.create({
        doc,
        extensions: [
          basicSetup,
          atlasEditorTheme,
          language.of([]),
          lsp.of([]),
          access.of(accessFor(readOnly)),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || applying) return;
            lastEmitted = update.state.doc.toString();
            onChange(lastEmitted);
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
    // Only `host` and `docKey` are dependencies. `text` changes on every
    // keystroke (it echoes the editor's own edits back), and `path`/`root` are
    // reconfigured elsewhere, so reading them tracked would rebuild the editor
    // — caret, focus and undo history included — on every key.
    view = untrack(() => {
      const next = create(container, text);
      void attachLanguage(next, path);
      void attachServer(next, path, root);
      return next;
    });
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
    if (!current || lastEmitted === next) return;
    lastEmitted = next;
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
      const uri = pathToFileUri(`${forRoot.replace(/[\\/]$/, "")}/${forPath}`);
      target.dispatch({
        effects: lsp.reconfigure([
          languageServerSupport(client, uri, languageId),
          hoverTooltips(),
          autocompletion({ override: [serverCompletionSource] }),
        ]),
      });
      log.info("lsp", `attached ${languageId} to ${forPath}`);
    } catch (e) {
      log.warn("lsp", `could not attach a language server to ${forPath}: ${e}`);
    }
  }

  /* The backend starts no language server in a workspace the user has not
     turned them on for. Say so, quietly, where the diagnostics would be — but
     only for a registered workspace, since that is the only thing Settings can
     turn them on for. */
  let offerLsp = $derived(
    $untrustedRoots.has(root) &&
      languageIdFor(path) !== "plaintext" &&
      $visibleWorkspaces.some((w) => w.path === root),
  );

  async function enableServers() {
    const target = view;
    try {
      // Resolves once the choice is on disk: the backend reads it from there.
      await setLspTrusted(root, true);
    } catch (e) {
      log.warn("lsp", `could not enable language servers for ${root}: ${e}`);
      return;
    }
    if (target && target === view) void attachServer(target, path, root);
  }

  /* A file that failed to load shows as an empty buffer; typing into it would
     only tempt a save over the real file, so it cannot be edited. */
  $effect(() => {
    const current = view;
    const locked = readOnly;
    current?.dispatch({ effects: access.reconfigure(accessFor(locked)) });
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
  });

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

<div class="code-wrap">
  <div class="code" bind:this={host}></div>
  {#if offerLsp}
    <div class="lsp-note" role="status">
      Language servers are off for this workspace.
      <button type="button" onclick={() => void enableServers()}>Enable</button>
    </div>
  {/if}
</div>

<style>
  .code-wrap {
    position: relative;
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .code {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--term-bg);
  }

  .lsp-note {
    position: absolute;
    right: 10px;
    bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    font-family: var(--font-ui);
    font-size: var(--fs-2xs);
    color: var(--muted);
  }

  .lsp-note button {
    padding: 0 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: transparent;
    font: inherit;
    color: var(--text);
    cursor: pointer;
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
