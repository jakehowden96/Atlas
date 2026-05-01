<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { TerminalSession } from "../../terminal-session";
  import ChatView from "../chat/ChatView.svelte";
  import { StreamParser } from "../../stream-parser";
  import { handleChatEvent, appendUserMessage, endStreaming, startStreaming } from "../../stores/chat";
  import { ptyWrite } from "../../ipc";
  import { getAdapter } from "../../adapters";
  import { getToolSettings, selectedTool } from "../../stores/settings";
  import { tabs, setTabTitle } from "../../stores/terminal";
  import { updateSessionLabelByTabId } from "../../stores/workspace";
  import { deriveTabTitle } from "../../terminal-utils";
  import { get } from "svelte/store";
  import "@xterm/xterm/css/xterm.css";

  interface Props {
    tabId: string;
    visible: boolean;
    ready?: boolean;
    onPtyReady: (ptyId: number) => void;
    cwd?: string;
    onData?: (data: string) => void;
    useStreamJson?: boolean;
    perTurnInvocation?: boolean;
    adapterId?: string;
    toolSessionId?: string;
    turnCount?: number;
  }

  let {
    tabId, visible, ready = true, onPtyReady, cwd, onData,
    useStreamJson = false, perTurnInvocation = false,
    adapterId, toolSessionId,
  }: Props = $props();

  let containerEl: HTMLDivElement;
  let session: TerminalSession | null = null;
  let streamParser: StreamParser | null = null;
  let ptyId: number | null = null;

  function handleStreamData(data: string) {
    if (streamParser) {
      streamParser.feed(data);
    }
  }

  function handleSendMessage(text: string) {
    if (ptyId === null || !adapterId) return;
    appendUserMessage(tabId, text);

    const adapter = getAdapter(adapterId);
    const settings = getToolSettings(get(selectedTool));
    const tab = get(tabs).find((t) => t.id === tabId);
    const currentTurnCount = (tab?.type === "terminal" ? tab.turnCount ?? 0 : 0);

    if (currentTurnCount === 0) {
      const title = deriveTabTitle(text);
      if (title) {
        setTabTitle(tabId, title, "auto");
        updateSessionLabelByTabId(tabId, title);
      }
    }

    if (perTurnInvocation && toolSessionId) {
      startStreaming(tabId);
      const cmd = adapter.buildSendCommand?.({
        message: text,
        toolSessionId,
        isFirstTurn: currentTurnCount === 0,
        settings,
      });
      if (cmd) {
        ptyWrite(ptyId, cmd);
        tabs.update((t) =>
          t.map((x) => (x.id === tabId && x.type === "terminal"
            ? { ...x, turnCount: currentTurnCount + 1 }
            : x)),
        );
      }
    } else if (useStreamJson) {
      const cmd = adapter.buildSendCommand?.({
        message: text,
        toolSessionId: toolSessionId ?? "",
        isFirstTurn: currentTurnCount === 0,
        settings,
      });
      ptyWrite(ptyId, cmd ?? (text + "\n"));
    } else {
      ptyWrite(ptyId, text + "\n");
    }
  }

  onMount(() => {
    if (useStreamJson || perTurnInvocation) {
      streamParser = new StreamParser((event) => {
        handleChatEvent(tabId, event);
      }, { perTurnMode: perTurnInvocation });
    }

    session = new TerminalSession({
      tabId,
      container: (useStreamJson || perTurnInvocation) ? undefined : containerEl,
      visible,
      onPtyReady: (id) => {
        ptyId = id;
        onPtyReady(id);
      },
      cwd,
      onData: (useStreamJson || perTurnInvocation) ? handleStreamData : onData,
      headless: useStreamJson || perTurnInvocation,
    });
  });

  onDestroy(() => {
    session?.destroy();
    streamParser?.flush();
    endStreaming(tabId);
  });

  $effect(() => {
    session?.handleVisibilityChange(visible);
  });

  $effect(() => {
    if (!useStreamJson && !perTurnInvocation && visible && ready) {
      session?.fitTerminal();
    }
  });
</script>

{#if useStreamJson || perTurnInvocation}
  <ChatView {tabId} onSendMessage={handleSendMessage} {visible} />
{:else}
  {#if visible && !ready}
    <div class="loading-overlay">
      <span class="material-symbols-outlined loading-spinner">progress_activity</span>
      <span class="loading-text">Starting session...</span>
    </div>
  {/if}
  <div
    class="terminal-container"
    class:hidden={!visible || !ready}
    bind:this={containerEl}
  ></div>
{/if}

<style>
  .terminal-container {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--surface);
  }

  .terminal-container.hidden {
    visibility: hidden;
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }

  .terminal-container :global(.xterm) {
    padding: 0 0 0 6px;
    height: 100%;
    margin-top: 2px;
    background: var(--surface);
  }

  .terminal-container :global(.xterm .xterm-viewport) {
    background-color: var(--surface) !important;
  }

  .loading-overlay {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    width: 100%;
    height: 100%;
    background: var(--surface);
  }

  .loading-spinner {
    font-size: 1.5rem;
    color: var(--primary);
    animation: spin 1s linear infinite;
  }

  .loading-text {
    font-size: 0.8rem;
    color: var(--on-surface-variant);
    font-family: var(--font-body);
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
