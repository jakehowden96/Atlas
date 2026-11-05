<script lang="ts">
  import type { Period } from "../../../../types/codeburn";

  let { period, refresh }: { period: Period; refresh: number } = $props();
</script>

<p data-period={period} data-refresh={refresh}>Yield is coming soon.</p>
