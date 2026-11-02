<script lang="ts">
  import "../app.css";
  import type { Component } from "svelte";

  const modules = import.meta.glob<{ default: Component }>("./sections/*.svelte", { eager: true });
  const sections = Object.entries(modules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, m]) => {
      const id = path.replace("./sections/", "").replace(".svelte", "");
      return { id, Section: m.default };
    });

  let theme = $state<"light" | "dark" | "system">("system");
  let width = $state(1100);
  let reduceMotion = $state(false);

  $effect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  });
</script>

<div class="shell" class:reduce={reduceMotion}>
  <nav class="side" aria-label="Sections">
    {#each sections as s (s.id)}
      <a href={`#${s.id}`}>{s.id}</a>
    {/each}
  </nav>
  <div class="main">
    <div class="bar" role="toolbar" aria-label="Gallery controls">
      <label>
        Theme
        <select bind:value={theme}>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
      </label>
      <label>
        Width
        <select bind:value={width}>
          <option value={800}>800</option>
          <option value={1100}>1100</option>
          <option value={1400}>1400</option>
        </select>
      </label>
      <label>
        <input type="checkbox" bind:checked={reduceMotion} />
        Reduce motion
      </label>
    </div>
    <div class="frame" style:width={`${width}px`}>
      {#each sections as { id, Section } (id)}
        <div {id} class="anchor"><Section /></div>
      {/each}
    </div>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-ui);
  }
  .shell {
    display: flex;
    min-height: 100vh;
  }
  .side {
    width: 200px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 16px;
    border-right: 1px solid var(--border);
    position: sticky;
    top: 0;
    align-self: flex-start;
  }
  .side a {
    color: var(--muted);
    font-size: var(--fs-sm);
    text-decoration: none;
  }
  .main {
    flex: 1;
    padding: 16px;
    overflow-x: auto;
  }
  .bar {
    display: flex;
    gap: 16px;
    align-items: center;
    font-size: var(--fs-sm);
    margin-bottom: 24px;
  }
  .reduce :global(*) {
    animation: none !important;
    transition: none !important;
  }
</style>
