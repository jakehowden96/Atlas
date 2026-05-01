<script lang="ts">
  import { relativeTime } from "../../format";

  interface Props {
    text: string;
    timestamp: number;
  }

  let { text, timestamp }: Props = $props();
</script>

<div class="message">
  <div class="message-header">
    <div class="avatar user">Y</div>
    <span class="author">You</span>
    <span class="time">{relativeTime(timestamp)}</span>
  </div>
  <div class="body">{text}</div>
</div>

<style>
  .message { display: flex; flex-direction: column; gap: 6px; }
  .message-header { display: flex; align-items: center; gap: 8px; }
  .avatar {
    width: 22px; height: 22px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 600; flex-shrink: 0;
    background: var(--surface-container-highest); color: var(--on-surface-variant);
  }
  .author { font-size: 12px; font-weight: 600; color: var(--on-surface); }
  .time { font-size: 10px; color: var(--on-surface-variant); opacity: 0.5; margin-left: auto; }
  .body {
    font-size: 13px; line-height: 1.6; color: var(--on-surface);
    padding-left: 30px; white-space: pre-wrap; word-break: break-word;
  }
</style>
