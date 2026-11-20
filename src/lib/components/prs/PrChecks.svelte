<script lang="ts">
  import { openUrl } from "../../ipc";
  import { errorMessage } from "../../ipc-error";
  import { groupChecks } from "../../pr-view";
  import type { Pr } from "../../stores/prs";
  import { showToast } from "../../stores/toast";
  import type { Check } from "../../../types/generated/Check";
  import Icon from "../ui/icon/icon.svelte";
  import StatusMark from "../app/common/StatusMark.svelte";

  interface Props {
    pr: Pr;
    id?: string;
  }

  let { pr, id }: Props = $props();

  let showPassed = $state(false);
  const groups = $derived(groupChecks(pr.checks));

  const reviewLine = $derived(
    pr.review.kind === "approved"
      ? "Approved"
      : pr.review.kind === "changes"
        ? "Changes requested"
        : pr.review.kind === "comments"
          ? `${pr.review.count} review ${pr.review.count === 1 ? "comment" : "comments"}`
          : "Awaiting review",
  );

  function open(check: Check) {
    if (!check.detailsUrl) return;
    openUrl(check.detailsUrl).catch((e) =>
      showToast("Failed to open check", { body: errorMessage(e) }),
    );
  }
</script>

{#snippet item(check: Check, state: "failing" | "running" | "done", word: string)}
  <li>
    <StatusMark {state} />
    <span class="name">{check.name}</span>
    <span class="word">{word}</span>
    {#if check.detailsUrl}
      <button type="button" class="out" aria-label="Open {check.name}" onclick={() => open(check)}>
        <Icon name="open_in_new" size={16} />
      </button>
    {/if}
  </li>
{/snippet}

<div class="checks" {id}>
  <p class="review">Review: {reviewLine}</p>
  {#if pr.checks.length === 0}
    <p class="none">No checks reported</p>
  {:else}
    <ul>
      {#each groups.failing as c (c.name)}{@render item(c, "failing", "Failed")}{/each}
      {#each groups.running as c (c.name)}{@render item(c, "running", "Running")}{/each}
    </ul>
    {#if groups.passed.length > 0}
      <button
        type="button"
        class="fold"
        aria-expanded={showPassed}
        onclick={() => (showPassed = !showPassed)}
      >
        {showPassed ? "Hide" : "Show"}
        {groups.passed.length} passed
      </button>
      {#if showPassed}
        <ul>
          {#each groups.passed as c (c.name)}{@render item(c, "done", "Passed")}{/each}
        </ul>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .checks {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    padding: var(--sp-3) var(--sp-4) var(--sp-4) var(--sp-8);
    border-top: 1px solid var(--border);
    background: var(--muted);
    font-size: var(--text-caption);
  }

  p {
    margin: 0;
  }

  .review,
  .none {
    color: var(--muted-foreground);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-width: 0;
  }

  .name {
    overflow: hidden;
    font-family: var(--font-mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .word {
    color: var(--muted-foreground);
  }

  .out,
  .fold {
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-foreground);
    font: inherit;
    cursor: pointer;
  }

  .out {
    display: grid;
    place-items: center;
    width: var(--h-xs);
    height: var(--h-xs);
  }

  .fold {
    align-self: flex-start;
    color: var(--success);
  }

  .out:hover {
    color: var(--foreground);
  }
</style>
