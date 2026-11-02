<script lang="ts">
  import type { Snippet } from "svelte";
  import Modal from "./Modal.svelte";

  interface Props {
    open: boolean;
    onClose: () => void;
    title?: string;
    labelledBy?: string;
    ariaLabel?: string;
    /** Panel width; anything CSS accepts. */
    width?: string;
    footer?: Snippet;
    children: Snippet;
  }

  let { width = "480px", ...rest }: Props = $props();
</script>

<!-- A drawer is a Modal docked to the right edge: same focus trap, Esc,
     restore-focus and exit animation, with its own layer and slide-in. -->
<Modal {...rest} {width} align="right" />
