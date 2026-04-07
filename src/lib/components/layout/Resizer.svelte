<script lang="ts">
  import { onDestroy } from "svelte";

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

  function handleKeydown(e: KeyboardEvent) {
    const step = e.shiftKey ? 50 : 10;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onResize(-step);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onResize(step);
    }
  }

  onDestroy(() => {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
</script>

<div
  class="resizer"
  class:active={isDragging}
  onmousedown={handleMouseDown}
  onkeydown={handleKeydown}
  role="separator"
  tabindex="0"
  aria-orientation="vertical"
  aria-label="Resize panel"
></div>

<style>
  .resizer {
    width: 0;
    cursor: col-resize;
    background: transparent;
    flex-shrink: 0;
    position: relative;
  }

  /* Wider invisible hit area for easier grabbing */
  .resizer::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: -3px;
    right: -3px;
  }

  .resizer:hover,
  .resizer.active {
    background: var(--primary);
  }
</style>
