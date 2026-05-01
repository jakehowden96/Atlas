<script lang="ts">
  import { onMount, tick } from "svelte";
  import UserMessage from "./UserMessage.svelte";
  import AgentMessage from "./AgentMessage.svelte";
  import ToolBlock from "./ToolBlock.svelte";
  import ChatInput from "./ChatInput.svelte";
  import { getSessionStore, type ChatSession } from "../../stores/chat";

  interface Props {
    tabId: string;
    onSendMessage: (text: string) => void;
    visible: boolean;
  }

  let { tabId, onSendMessage, visible }: Props = $props();
  let scrollEl: HTMLDivElement | undefined = $state();
  let session: ChatSession | null = $state(null);
  let prevMessageCount = 0;

  const sessionStore = getSessionStore(tabId);

  onMount(() => {
    const unsub = sessionStore.subscribe((s) => {
      session = s;
    });
    return unsub;
  });

  $effect(() => {
    if (session && session.messages.length > prevMessageCount) {
      prevMessageCount = session.messages.length;
      tick().then(() => {
        if (scrollEl) {
          scrollEl.scrollTop = scrollEl.scrollHeight;
        }
      });
    }
  });
</script>

{#if visible}
  <div class="chat-view">
    <div class="chat-scroll" bind:this={scrollEl}>
      <div class="chat-content">
        {#if session}
          {#each session.messages as msg (msg.id)}
            {#if msg.type === "user"}
              <UserMessage text={msg.text} timestamp={msg.timestamp} />
            {:else if msg.type === "agent"}
              <AgentMessage text={msg.text} timestamp={msg.timestamp} />
            {:else if msg.type === "tool"}
              <ToolBlock call={msg.call} />
            {/if}
          {/each}
          {#if session.streaming && session.messages.length > 0}
            <div class="thinking">
              <div class="thinking-dots">
                <span class="dot"></span><span class="dot"></span><span class="dot"></span>
              </div>
            </div>
          {/if}
        {/if}
      </div>
    </div>
    <div class="chat-input-container">
      <ChatInput
        onSend={onSendMessage}
        model={session?.meta.model ?? ""}
        disabled={session?.streaming ?? false}
      />
    </div>
  </div>
{/if}

<style>
  .chat-view {
    display: flex; flex-direction: column;
    height: 100%; background: var(--surface-container-low);
  }

  .chat-scroll {
    flex: 1; overflow-y: auto; padding: 24px 32px;
  }
  .chat-scroll::-webkit-scrollbar { width: 6px; }
  .chat-scroll::-webkit-scrollbar-track { background: transparent; }
  .chat-scroll::-webkit-scrollbar-thumb { background: var(--outline-variant); border-radius: 3px; }

  .chat-content {
    max-width: 760px; margin: 0 auto;
    display: flex; flex-direction: column; gap: 20px;
  }

  .chat-input-container {
    padding: 0 32px 16px;
    max-width: 760px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }

  .thinking {
    margin-left: 30px; padding: 8px 0;
    display: flex; align-items: center; gap: 8px;
  }
  .thinking-dots { display: flex; gap: 4px; }
  .dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--primary); opacity: 0.4;
    animation: pulse 1.4s infinite;
  }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes pulse {
    0%, 100% { opacity: 0.2; }
    50% { opacity: 0.8; }
  }
</style>
