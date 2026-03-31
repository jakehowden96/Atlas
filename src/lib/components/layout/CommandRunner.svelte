<script lang="ts">
</script>

<div class="command-runner">
  <div class="runner-inner">
    <div class="runner-icon">
      <span class="material-symbols-outlined">smart_toy</span>
    </div>
    <div class="runner-input-wrap">
      <input
        type="text"
        class="runner-input"
        placeholder="Ask AI to refactor, debug, or document..."
      />
    </div>
    <button class="runner-send">
      <span class="material-symbols-outlined">send</span>
    </button>
  </div>
</div>

<style>
  .command-runner {
    position: fixed;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    width: 100%;
    max-width: 36rem;
    z-index: 60;
    padding: 0 1rem;
    pointer-events: none;
  }

  .runner-inner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem;
    background: color-mix(in srgb, var(--surface-container-highest) 80%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid color-mix(in srgb, var(--primary) 20%, transparent);
    border-radius: var(--radius-lg);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    pointer-events: auto;
    overflow: hidden;
  }

  .runner-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    background: color-mix(in srgb, var(--primary) 10%, transparent);
    border-radius: var(--radius);
    margin-left: 0.25rem;
  }

  .runner-icon :global(.material-symbols-outlined) {
    color: var(--primary);
    font-size: 1.25rem;
  }

  .runner-input-wrap {
    flex: 1;
    padding: 0 0.5rem;
  }

  .runner-input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    color: var(--on-surface);
    font-size: 0.85rem;
    font-family: var(--font-body);
  }

  .runner-input::placeholder {
    color: color-mix(in srgb, var(--on-surface-variant) 40%, transparent);
  }

  .runner-send {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    border-radius: var(--radius);
    transition: background 0.15s, color 0.15s;
  }

  .runner-send:hover {
    background: var(--surface-bright);
    color: var(--primary);
  }

  .runner-send :global(.material-symbols-outlined) {
    font-size: 1.15rem;
  }
</style>
