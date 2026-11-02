<script lang="ts">
  import { connectorLogo } from "../../connector-logos";

  interface Props {
    connector: string;
    size?: 16 | 20 | 24 | 32;
    label?: string;
  }

  let { connector, size = 24, label }: Props = $props();
  const svg = $derived(connectorLogo(connector));
</script>

<span
  class="logo"
  class:fallback={!svg}
  style:width="{size}px"
  style:height="{size}px"
  role={label ? "img" : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}
>
  {#if svg}{@html svg}{:else}{connector.charAt(0).toUpperCase()}{/if}
</span>

<style>
  .logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    color: var(--text);
  }
  .logo :global(svg) {
    width: 100%;
    height: 100%;
  }
  .fallback {
    background: var(--surface3);
    border-radius: var(--r-md);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
</style>
