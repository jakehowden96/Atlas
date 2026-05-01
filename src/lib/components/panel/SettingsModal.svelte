<script lang="ts">
  import { settingsOpen, selectedTool, toolSettings, enableNotifications, setEnableNotifications, setSelectedTool, setToolSetting } from "../../stores/settings";
  import { listAdapters, getAdapter } from "../../adapters";

  type Tab = "general" | "agent" | "danger";

  let activeTab = $state<Tab>("general");
  let modalEl: HTMLDivElement | null = $state(null);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "general", label: "General", icon: "tune" },
    { id: "agent", label: "Agent", icon: "smart_toy" },
    { id: "danger", label: "Danger Zone", icon: "warning" },
  ];

  const adapters = listAdapters();

  let activeAdapter = $derived(getAdapter($selectedTool));
  let currentToolSettings = $derived($toolSettings[$selectedTool] ?? {});
  let generalSettings = $derived(activeAdapter.settingsSchema.filter((s) => !s.dangerous));
  let dangerSettings = $derived(activeAdapter.settingsSchema.filter((s) => s.dangerous));

  function getSettingValue(key: string, defaultValue: boolean | string): boolean | string {
    return currentToolSettings[key] ?? defaultValue;
  }

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
          {#each tabs as tab (tab.id)}
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
                  <span class="toggle-desc">Show OS notifications when the agent needs input in a background tab</span>
                </div>
                <input
                  type="checkbox"
                  class="settings-checkbox"
                  checked={$enableNotifications}
                  onchange={(e) => setEnableNotifications(e.currentTarget.checked)}
                />
              </label>
            </div>

          {:else if activeTab === "agent"}
            <div class="section">
              <div class="section-label">Agent Tool</div>
              <select
                class="tool-select"
                value={$selectedTool}
                onchange={(e) => setSelectedTool(e.currentTarget.value)}
              >
                {#each adapters as adapter (adapter.id)}
                  <option value={adapter.id}>{adapter.displayName}</option>
                {/each}
              </select>
              <span class="select-desc">Choose which AI coding agent runs in Atlas terminal sessions</span>
            </div>

            {#if generalSettings.length > 0}
              <div class="section" style="margin-top: 1rem;">
                <div class="section-label">Tool Settings</div>
                {#each generalSettings as setting (setting.key)}
                  {#if setting.type === "boolean"}
                    <label class="toggle-row" style="margin-bottom: 0.5rem;">
                      <div class="toggle-text">
                        <span class="toggle-title">{setting.label}</span>
                        <span class="toggle-desc">{setting.description}</span>
                      </div>
                      <input
                        type="checkbox"
                        class="settings-checkbox"
                        checked={!!getSettingValue(setting.key, setting.defaultValue)}
                        onchange={(e) => setToolSetting($selectedTool, setting.key, e.currentTarget.checked)}
                      />
                    </label>
                  {:else if setting.type === "string"}
                    <div class="input-row">
                      <span class="toggle-title">{setting.label}</span>
                      <span class="toggle-desc">{setting.description}</span>
                      <input
                        type="text"
                        class="settings-input"
                        value={getSettingValue(setting.key, setting.defaultValue) as string}
                        placeholder={setting.defaultValue as string || setting.label}
                        onchange={(e) => setToolSetting($selectedTool, setting.key, e.currentTarget.value)}
                      />
                    </div>
                  {:else if setting.type === "select" && setting.options}
                    <div class="input-row">
                      <span class="toggle-title">{setting.label}</span>
                      <span class="toggle-desc">{setting.description}</span>
                      <select
                        class="tool-select"
                        value={getSettingValue(setting.key, setting.defaultValue) as string}
                        onchange={(e) => setToolSetting($selectedTool, setting.key, e.currentTarget.value)}
                      >
                        {#each setting.options as opt (opt.value)}
                          <option value={opt.value}>{opt.label}</option>
                        {/each}
                      </select>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}

          {:else if activeTab === "danger"}
            {#if dangerSettings.length > 0}
              <div class="section danger-section">
                <div class="section-label danger-label">Danger Zone</div>
                {#each dangerSettings as setting (setting.key)}
                  {#if setting.type === "boolean"}
                    <label class="toggle-row danger-toggle" style="margin-bottom: 0.5rem;">
                      <div class="toggle-text">
                        <span class="toggle-title danger-text">{setting.label}</span>
                        <span class="toggle-desc danger-desc">{setting.description}</span>
                      </div>
                      <input
                        type="checkbox"
                        class="danger-checkbox"
                        checked={!!getSettingValue(setting.key, setting.defaultValue)}
                        onchange={(e) => setToolSetting($selectedTool, setting.key, e.currentTarget.checked)}
                      />
                    </label>
                  {/if}
                {/each}
                <span class="danger-note">Dangerous settings are specific to the selected agent tool ({activeAdapter.displayName})</span>
              </div>
            {:else}
              <div class="section">
                <span class="toggle-desc">No dangerous settings for {activeAdapter.displayName}</span>
              </div>
            {/if}
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

  .section-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--on-surface-variant);
    font-family: var(--font-body);
    margin-bottom: 0.35rem;
  }

  /* ── Tool selector ── */
  .tool-select {
    width: 100%;
    padding: 0.45rem 0.6rem;
    background: var(--surface-container-high);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-sm);
    color: var(--on-surface);
    font-family: var(--font-body);
    font-size: 12px;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }

  .tool-select:focus {
    outline: none;
    border-color: var(--primary);
  }

  .select-desc {
    display: block;
    font-size: 11px;
    color: var(--on-surface-variant);
    opacity: 0.7;
    margin-top: 0.35rem;
    line-height: 1.35;
  }

  /* ── Settings inputs ── */
  .settings-input {
    width: 100%;
    padding: 0.45rem 0.6rem;
    background: var(--surface-container-high);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-sm);
    color: var(--on-surface);
    font-family: var(--font-body);
    font-size: 12px;
    margin-top: 0.35rem;
  }

  .settings-input:focus {
    outline: none;
    border-color: var(--primary);
  }

  .settings-input::placeholder {
    color: var(--on-surface-variant);
    opacity: 0.5;
  }

  .input-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 0.5rem;
  }

  /* ── Toggle checkbox ── */
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

  .danger-note {
    display: block;
    font-size: 10px;
    color: var(--on-surface-variant);
    opacity: 0.6;
    margin-top: 0.5rem;
    font-style: italic;
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
