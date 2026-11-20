<script lang="ts" module>
  import type { Tab } from "../common/TabStrip.svelte";

  export const NAV: Tab[] = [
    { id: "general", label: "General", group: "App" },
    { id: "keyboard", label: "Keyboard", group: "App" },
    { id: "workspaces", label: "Workspaces", group: "Work" },
    { id: "connectors", label: "Connectors", group: "Work" },
    { id: "pullRequests", label: "Pull requests", group: "Work" },
    { id: "harnesses", label: "Harnesses", group: "Work" },
    { id: "claude", label: "Claude Code", group: "System" },
    { id: "about", label: "About", group: "System" },
  ];
</script>

<script lang="ts">
  /** Left column of the settings dialog: search, grouped sections, version line. */
  import type { SectionId } from "../../../settings-search";
  import SearchInput from "../common/SearchInput.svelte";
  import Tabs from "../common/TabStrip.svelte";

  let {
    section = $bindable(),
    query = $bindable(),
    searchBox = $bindable(),
    version,
  }: {
    section: SectionId;
    query: string;
    searchBox?: HTMLElement;
    version: string;
  } = $props();
</script>

<nav class="nav">
  <div class="nav-title">Settings</div>
  <div bind:this={searchBox}>
    <SearchInput bind:value={query} placeholder="Search settings" aria-label="Search settings" />
  </div>
  <Tabs
    tabs={NAV}
    value={section}
    onselect={(id) => {
      section = id as SectionId;
      query = "";
    }}
    vertical
    label="Settings sections"
  />
  <div class="nav-spacer"></div>
  <div class="version">Atlas {version} · ~/.atlas</div>
</nav>

<style>
  .nav {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
    width: 200px;
    padding: 14px 8px;
    border-right: 1px solid var(--border);
    background: var(--background);
    overflow: auto;
  }

  .nav-title {
    padding: 0 10px 4px;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .nav-spacer {
    flex: 1;
  }

  .version {
    padding: 0 10px;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
</style>
