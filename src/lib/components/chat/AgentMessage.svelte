<script lang="ts">
  import MarkdownRenderer from "../panel/MarkdownRenderer.svelte";
  import { relativeTime } from "../../format";

  interface Props {
    text: string;
    timestamp: number;
  }

  let { text, timestamp }: Props = $props();
</script>

<div class="message">
  <div class="message-header">
    <div class="avatar agent">
      <span class="material-symbols-outlined" style="font-size:14px">auto_awesome</span>
    </div>
    <span class="author">Agent</span>
    <span class="time">{relativeTime(timestamp)}</span>
  </div>
  <div class="body">
    <MarkdownRenderer content={text} />
  </div>
</div>

<style>
  .message { display: flex; flex-direction: column; gap: 6px; }
  .message-header { display: flex; align-items: center; gap: 8px; }
  .avatar {
    width: 22px; height: 22px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    background: color-mix(in srgb, var(--primary) 20%, transparent);
    color: var(--primary);
  }
  .author { font-size: 12px; font-weight: 600; color: var(--on-surface); }
  .time { font-size: 10px; color: var(--on-surface-variant); opacity: 0.5; margin-left: auto; }
  .body {
    font-size: 13px; line-height: 1.6; color: var(--on-surface);
    padding-left: 30px;
  }
</style>
