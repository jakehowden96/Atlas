<script lang="ts">
  import { togglePanel } from "../../stores/panel";
</script>

<header class="header">
  <div class="header-left">
    <span class="brand">TERMINAL_OS</span>
    <nav class="nav-links">
      <a href="#explorer" class="nav-link">Explorer</a>
      <a href="#debugger" class="nav-link">Debugger</a>
      <a href="#network" class="nav-link">Network</a>
      <a href="#settings" class="nav-link">Settings</a>
    </nav>
  </div>
  <div class="header-right">
    <div class="search-box">
      <span class="material-symbols-outlined search-icon">search</span>
      <input type="text" placeholder="Search Commands..." class="search-input" />
    </div>
    <div class="toolbar">
      <button class="toolbar-btn" onclick={togglePanel} title="Toggle Panel (Ctrl+Shift+\\)">
        <span class="material-symbols-outlined">split_screen</span>
      </button>
      <button class="toolbar-btn" title="Terminal">
        <span class="material-symbols-outlined">terminal</span>
      </button>
      <button class="toolbar-btn" title="History">
        <span class="material-symbols-outlined">history</span>
      </button>
    </div>
  </div>
</header>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1.5rem;
    height: 40px;
    background: var(--surface);
    flex-shrink: 0;
    z-index: 50;
    user-select: none;
    -webkit-user-select: none;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 2rem;
  }

  .brand {
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: -0.04em;
    color: var(--on-surface);
  }

  .nav-links {
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }

  .nav-link {
    font-family: var(--font-display);
    font-size: 0.8rem;
    letter-spacing: -0.01em;
    color: var(--on-surface-variant);
    text-decoration: none;
    transition: color 0.15s;
  }

  .nav-link:hover {
    color: var(--on-surface);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .search-box {
    display: flex;
    align-items: center;
    background: var(--surface-container-high);
    border-radius: 9999px;
    padding: 0.25rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--outline-variant) 20%, transparent);
  }

  .search-icon {
    font-size: 0.75rem;
    color: var(--on-surface-variant);
    margin-right: 0.5rem;
  }

  .search-input {
    background: transparent;
    border: none;
    outline: none;
    font-size: 0.75rem;
    color: var(--on-surface);
    font-family: var(--font-body);
    width: 8rem;
  }

  .search-input::placeholder {
    color: color-mix(in srgb, var(--on-surface-variant) 60%, transparent);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.35rem;
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    border-radius: var(--radius);
    transition: background 0.15s, color 0.15s;
  }

  .toolbar-btn:hover {
    background: var(--surface-container-high);
    color: var(--on-surface);
  }

  .toolbar-btn :global(.material-symbols-outlined) {
    font-size: 1.2rem;
  }
</style>
