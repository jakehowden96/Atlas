<script lang="ts">
</script>

<footer class="status-bar">
  <div class="status-left">
    <div class="status-indicator">
      <span class="status-dot"></span>
      <span class="status-text">CONNECTED</span>
    </div>
    <span class="status-meta">LATENCY: 12ms</span>
  </div>
  <div class="status-right">
    <span class="status-meta">UTF-8</span>
    <span class="status-meta">zsh</span>
    <div class="status-indicator">
      <span class="material-symbols-outlined notification-icon">notifications</span>
      <span class="status-meta">No Alerts</span>
    </div>
  </div>
</footer>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 24px;
    padding: 0 1rem;
    background: var(--surface-container-lowest);
    flex-shrink: 0;
    z-index: 50;
    user-select: none;
    -webkit-user-select: none;
  }

  .status-left,
  .status-right {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .status-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--secondary);
    box-shadow: 0 0 8px color-mix(in srgb, var(--secondary) 40%, transparent);
  }

  .status-text {
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--on-surface-variant);
    letter-spacing: 0.04em;
  }

  .status-meta {
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--on-surface-variant);
  }

  .notification-icon {
    font-size: 10px;
    color: var(--on-surface-variant);
  }
</style>
