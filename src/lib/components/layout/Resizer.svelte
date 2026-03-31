<script lang="ts">
  interface Props {
    onResize: (delta: number) => void;
  }

  let { onResize }: Props = $props();
  let isDragging = $state(false);
  let startX = 0;

  function handleMouseDown(e: MouseEvent) {
    isDragging = true;
    startX = e.clientX;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    const delta = startX - e.clientX;
    startX = e.clientX;
    onResize(delta);
  }

  function handleMouseUp() {
    isDragging = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }
</script>

<div
  class="resizer"
  class:active={isDragging}
  onmousedown={handleMouseDown}
  role="separator"
  aria-orientation="vertical"
></div>

<style>
  .resizer {
    width: 4px;
    cursor: col-resize;
    background: transparent;
    transition: background 0.15s;
    flex-shrink: 0;
  }

  .resizer:hover,
  .resizer.active {
    background: var(--blue);
  }
</style>
