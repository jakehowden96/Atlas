<script lang="ts">
  let { fail }: { fail: { on: boolean } } = $props();
  // svelte-ignore state_referenced_locally
  if (fail.on) {
    const err = new Error("boom");
    err.stack = `Error: boom\n${Array.from({ length: 40 }, (_, i) => `    at frame${i} (src/lib/some/deep/path/File${i}.svelte:${i + 1}:${i + 3})`).join("\n")}`;
    throw err;
  }
</script>

<p>child ok</p>
