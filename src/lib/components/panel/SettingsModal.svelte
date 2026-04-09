<script lang="ts">
  import { settingsOpen, skipPermissions, setSkipPermissions, enableNotifications, setEnableNotifications } from "../../stores/settings";

  type Tab = "general" | "danger";

  let activeTab = $state<Tab>("general");
  let modalEl: HTMLDivElement | null = $state(null);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "general", label: "General", icon: "tune" },
    { id: "danger", label: "Danger Zone", icon: "warning" },
  ];

  $effect(() => {
    if ($settingsOpen) {
      activeTab = "general";
      requestAnimationFrame(() => modalEl?.focus());
    }
  });

  function handleModalKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      close();
    }
  }

  function close() {
    settingsOpen.set(false);
  }
</script>

{#if $settingsOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="settings-overlay" onclick={close} role="presentation">
    <div
      class="settings-modal"
      bind:this={modalEl}
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleModalKeydown}
      role="dialog"
      aria-labelledby="settings-title"
      tabindex="-1"
    >
      <div class="settings-header">
        <span class="settings-title" id="settings-title">Settings</span>
        <button class="close-btn" onclick={close}>
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="settings-layout">
        <nav class="settings-sidebar">
          {#each tabs as tab}
            <button
              class="sidebar-tab"
              class:active={activeTab === tab.id}
              class:danger-tab={tab.id === "danger"}
              onclick={() => activeTab = tab.id}
            >
              <span class="material-symbols-outlined tab-icon" class:danger-icon={tab.id === "danger"}>{tab.icon}</span>
              <span class="tab-label">{tab.label}</span>
            </button>
          {/each}
        </nav>

        <div class="settings-content">
          {#if activeTab === "general"}
            <div class="section">
              <div class="section-label">Notifications</div>
              <label class="toggle-row">
                <div class="toggle-text">
                  <span class="toggle-title">System Notifications</span>
                  <span class="toggle-desc">Show OS notifications when Claude needs input in a background tab</span>
                </div>
                <input
                  type="checkbox"
                  class="settings-checkbox"
                  checked={$enableNotifications}
                  onchange={(e) => setEnableNotifications(e.currentTarget.checked)}
                />
              </label>
            </div>
          {:else if activeTab === "danger"}
            <div class="section danger-section">
              <div class="section-label danger-label">Danger Zone</div>
              <label class="toggle-row danger-toggle">
                <div class="toggle-text">
                  <span class="toggle-title danger-text">Skip Permissions</span>
                  <span class="toggle-desc danger-desc">Launch all Claude sessions with <code>--dangerously-skip-permissions</code></span>
                </div>
                <input
                  type="checkbox"
                  class="danger-checkbox"
                  checked={$skipPermissions}
                  onchange={(e) => setSkipPermissions(e.currentTarget.checked)}
                />
              </label>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 100;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 48px;
  }

  .settings-modal {
    width: 100%;
    max-width: 480px;
    background: var(--surface-container-low);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-lg);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
    overflow: hidden;
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--outline-variant);
  }

  .settings-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--on-surface);
    font-family: var(--font-body);
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    border-radius: var(--radius-sm);
    padding: 0;
    transition: background 0.15s, color 0.15s;
  }

  .close-btn:hover {
    background: var(--surface-container-high);
    color: var(--on-surface);
  }

  .close-btn :global(.material-symbols-outlined) {
    font-size: 1rem;
  }

  /* ── Tabbed layout ── */
  .settings-layout {
    display: flex;
    min-height: 280px;
  }

  .settings-sidebar {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0.5rem;
    border-right: 1px solid var(--outline-variant);
    background: var(--surface);
    width: 140px;
    flex-shrink: 0;
  }

  .sidebar-tab {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.6rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--on-surface-variant);
    font-size: 12px;
    font-weight: 500;
    font-family: var(--font-body);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    text-align: left;
    white-space: nowrap;
  }

  .sidebar-tab:hover {
    background: var(--surface-container-high);
    color: var(--on-surface);
  }

  .sidebar-tab.active {
    background: var(--surface-container-high);
    color: var(--on-surface);
    font-weight: 600;
  }

  .sidebar-tab.danger-tab:hover,
  .sidebar-tab.danger-tab.active {
    color: #ef4444;
  }

  .tab-icon {
    font-size: 1rem;
  }

  .danger-icon {
    color: #ef4444;
  }

  .tab-label {
    line-height: 1;
  }

  .settings-content {
    flex: 1;
    padding: 1rem;
    overflow-y: auto;
    min-width: 0;
  }

  /* ── Sections ── */
  .section-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--on-surface-variant);
    font-family: var(--font-body);
    margin-bottom: 0.35rem;
  }

  /* ── Settings checkbox (neutral toggle) ── */
  .settings-checkbox {
    appearance: none;
    -webkit-appearance: none;
    width: 36px;
    height: 20px;
    background: var(--surface-container-highest);
    border: 1px solid var(--outline-variant);
    border-radius: 10px;
    position: relative;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.2s, border-color 0.2s;
  }

  .settings-checkbox::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    background: var(--on-surface-variant);
    border-radius: 50%;
    transition: transform 0.2s, background 0.2s;
  }

  .settings-checkbox:checked {
    background: var(--primary);
    border-color: var(--primary);
  }

  .settings-checkbox:checked::after {
    transform: translateX(16px);
    background: white;
  }

  /* ── Danger zone ── */
  .danger-section {
    border: 1px solid color-mix(in srgb, #ef4444 30%, transparent);
    border-radius: var(--radius-sm);
    padding: 0.75rem;
  }

  .danger-label {
    color: #ef4444;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    cursor: pointer;
  }

  .toggle-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .toggle-title {
    font-size: 12px;
    font-weight: 600;
    font-family: var(--font-body);
    color: var(--on-surface);
  }

  .danger-text {
    color: #ef4444;
  }

  .toggle-desc {
    font-size: 11px;
    color: var(--on-surface-variant);
    font-family: var(--font-body);
    opacity: 0.7;
    line-height: 1.35;
  }

  .toggle-desc code {
    font-family: var(--font-mono);
    font-size: 10px;
    background: var(--surface-container-high);
    padding: 1px 4px;
    border-radius: 3px;
    color: #ef4444;
  }

  .danger-desc {
    color: color-mix(in srgb, #ef4444 70%, var(--on-surface-variant));
  }

  .danger-checkbox {
    appearance: none;
    -webkit-appearance: none;
    width: 36px;
    height: 20px;
    background: var(--surface-container-highest);
    border: 1px solid var(--outline-variant);
    border-radius: 10px;
    position: relative;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.2s, border-color 0.2s;
  }

  .danger-checkbox::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    background: var(--on-surface-variant);
    border-radius: 50%;
    transition: transform 0.2s, background 0.2s;
  }

  .danger-checkbox:checked {
    background: #ef4444;
    border-color: #ef4444;
  }

  .danger-checkbox:checked::after {
    transform: translateX(16px);
    background: white;
  }
</style>
