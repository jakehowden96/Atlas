<script lang="ts">
  import { activeSection, setSection } from "../../stores/panel";
  import type { PanelSection } from "../../../types/panel";

  const navItems: { id: PanelSection; label: string; icon: string }[] = [
    { id: "diff", label: "Git Diff", icon: "difference" },
    { id: "summary", label: "Summary", icon: "description" },
    { id: "flow", label: "Flow", icon: "account_tree" },
  ];
</script>

<aside class="sidebar">
  <div class="project-info">
    <div class="project-avatar">PA</div>
    <div class="project-meta">
      <span class="project-name">Project</span>
      <span class="project-branch">branch:main</span>
    </div>
  </div>

  <nav class="nav">
    <div class="nav-label">Navigation</div>
    {#each navItems as item (item.id)}
      <button
        class="nav-item"
        class:active={$activeSection === item.id}
        onclick={() => setSection(item.id)}
      >
        <span class="material-symbols-outlined">{item.icon}</span>
        <span class="nav-text">{item.label}</span>
      </button>
    {/each}
  </nav>

  <div class="sidebar-footer">
    <div class="footer-links">
      <button class="footer-link">
        <span class="material-symbols-outlined footer-icon">help_outline</span>
        <span>Help</span>
      </button>
      <button class="footer-link">
        <span class="material-symbols-outlined footer-icon">sensors</span>
        <span>Status</span>
      </button>
    </div>
  </div>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    width: 256px;
    height: 100%;
    background: var(--surface-container-low);
    flex-shrink: 0;
    user-select: none;
    -webkit-user-select: none;
    z-index: 40;
  }

  .project-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1.25rem 1.25rem;
  }

  .project-avatar {
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius);
    background: var(--primary-container);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--on-primary);
    font-weight: 700;
    font-size: 0.7rem;
    font-family: var(--font-display);
    flex-shrink: 0;
  }

  .project-meta {
    display: flex;
    flex-direction: column;
  }

  .project-name {
    font-size: 0.85rem;
    font-weight: 900;
    color: var(--primary);
    font-family: var(--font-body);
  }

  .project-branch {
    font-size: 10px;
    color: var(--on-surface-variant);
    font-family: var(--font-mono);
  }

  .nav {
    flex: 1;
    padding: 0 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .nav-label {
    padding: 0 0.75rem;
    margin-bottom: 0.5rem;
    font-size: 10px;
    font-family: var(--font-body);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--on-surface-variant);
    opacity: 0.5;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.55rem 0.75rem;
    background: transparent;
    border: none;
    border-left: 4px solid transparent;
    border-radius: var(--radius);
    color: var(--on-surface-variant);
    font-size: 0.75rem;
    font-family: var(--font-body);
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, padding-left 0.15s, border-color 0.15s;
  }

  .nav-item:hover {
    background: color-mix(in srgb, var(--surface-container-high) 50%, transparent);
    padding-left: 1rem;
  }

  .nav-item.active {
    background: var(--surface-container-high);
    color: var(--on-surface);
    border-left-color: var(--primary);
    font-weight: 500;
    padding-left: 1rem;
  }

  .nav-item :global(.material-symbols-outlined) {
    font-size: 1.15rem;
  }

  .nav-text {
    white-space: nowrap;
  }

  .sidebar-footer {
    margin-top: auto;
    padding: 1rem 0.5rem;
  }

  .footer-links {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .footer-link {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: none;
    border: none;
    color: var(--on-surface-variant);
    font-size: 11px;
    font-family: var(--font-body);
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: color 0.15s;
  }

  .footer-link:hover {
    color: var(--on-surface);
  }

  .footer-icon {
    font-size: 0.9rem;
  }
</style>
