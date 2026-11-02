<script lang="ts">
  import ConnectorLogo from "./ConnectorLogo.svelte";

  interface Props {
    connector: string;
    label?: string;
  }

  let { connector, label }: Props = $props();
</script>

<span class="tile">
  <ConnectorLogo {connector} size={20} {label} />
</span>

<style>
  .tile {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 32px;
    height: 32px;
    background: var(--surface3);
    border-radius: var(--r-md);
  }
</style>
