<script lang="ts">
  import ErrorBoundary from "../components/app/shell/ErrorBoundary.svelte";
  import Thrower from "./ThrowerFixture.svelte";
  let { fail }: { fail: { on: boolean } } = $props();
</script>

<p>sibling</p>
<ErrorBoundary name="Review"><Thrower {fail} /></ErrorBoundary>
