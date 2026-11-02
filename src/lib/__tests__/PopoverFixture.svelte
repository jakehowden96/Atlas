<script lang="ts">
  import Popover from "../components/ui/Popover.svelte";

  let open = $state(false);
  let trigger = $state<HTMLElement>();
</script>

<button bind:this={trigger} onclick={() => (open = !open)}>Open</button>
<p>Outside</p>
<Popover bind:open {trigger} label="Options"><button>Inside</button></Popover>
