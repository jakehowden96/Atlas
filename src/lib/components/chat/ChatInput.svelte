<script lang="ts">
  interface Props {
    onSend: (text: string) => void;
    model?: string;
    disabled?: boolean;
  }

  let { onSend, model = "", disabled = false }: Props = $props();
  let text = $state("");
  let textareaEl: HTMLTextAreaElement | undefined = $state();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function send() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    text = "";
    if (textareaEl) textareaEl.style.height = "auto";
  }

  function autoResize(e: Event) {
    const el = e.target as HTMLTextAreaElement;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }
</script>

<div class="input-area">
  <div class="input-box" class:disabled>
    <textarea
      bind:this={textareaEl}
      bind:value={text}
      onkeydown={handleKeydown}
      oninput={autoResize}
      rows="1"
      placeholder="Ask Atlas anything..."
      {disabled}
    ></textarea>
    <button class="send-btn" onclick={send} disabled={!text.trim() || disabled}>
      <span class="material-symbols-outlined">arrow_upward</span>
    </button>
  </div>
  <div class="hints">
    {#if model}
      <span class="hint-model">{model}</span>
    {/if}
    <span class="hint-shortcut"><kbd>Enter</kbd> to send</span>
  </div>
</div>

<style>
  .input-area { padding: 12px 0 0; }

  .input-box {
    display: flex; align-items: flex-end;
    background: var(--surface-container);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius); padding: 10px 12px; gap: 8px;
    transition: border-color 0.15s;
  }
  .input-box:focus-within { border-color: var(--primary); }
  .input-box.disabled { opacity: 0.5; pointer-events: none; }

  textarea {
    flex: 1; background: none; border: none; outline: none;
    color: var(--on-surface); font-family: var(--font-body);
    font-size: 13px; line-height: 1.5; resize: none;
    min-height: 20px; max-height: 120px;
  }
  textarea::placeholder { color: var(--on-surface-variant); opacity: 0.5; }

  .send-btn {
    width: 28px; height: 28px; border-radius: 50%;
    border: none; background: var(--primary); color: #002f58;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; flex-shrink: 0;
    transition: background 0.15s, opacity 0.15s;
  }
  .send-btn:hover { background: #8ec4ff; }
  .send-btn:disabled { opacity: 0.3; cursor: default; }
  .send-btn :global(.material-symbols-outlined) { font-size: 18px; }

  .hints {
    display: flex; gap: 8px; margin-top: 6px; align-items: center;
    justify-content: flex-end;
  }
  .hint-model {
    font-size: 10px; font-family: var(--font-mono);
    color: var(--on-surface-variant); opacity: 0.5;
    background: var(--surface-container); padding: 2px 8px; border-radius: 4px;
  }
  .hint-shortcut {
    font-size: 10px; color: var(--on-surface-variant); opacity: 0.4;
  }
  .hint-shortcut kbd {
    font-family: var(--font-mono); font-size: 9px;
    background: var(--surface-container); padding: 0 4px; border-radius: 2px;
  }
</style>
