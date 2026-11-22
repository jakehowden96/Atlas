<script module lang="ts">
  export interface Segment<Id extends string = string> {
    id: Id;
    label: string;
    /** Rendered as a mono numeral after the label. */
    count?: number;
    /** Renders the count as a warning badge instead (PRs needing attention). */
    alert?: boolean;
    /** A bare warning dot after the label: a state rather than a count. */
    dot?: boolean;
    /** Shown but not selectable. */
    disabled?: boolean;
  }
</script>

<script lang="ts" generics="Id extends string">
  /*
   * A segmented control built from shadcn parts.
   * role "tablist" (default): swaps a panel. shadcn Tabs (list only; the caller owns the panel).
   * role "radiogroup": sets a value. shadcn ToggleGroup, single.
   */
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { cn } from "$lib/utils.js";

  interface Props {
    options: Segment<Id>[];
    value: Id;
    onChange: (id: Id) => void;
    /** "md" = 24px segments, "sm" = 22px. */
    size?: "md" | "sm";
    /** Stretch the segments to fill the row. */
    fill?: boolean;
    role?: "tablist" | "radiogroup";
    label?: string;
  }

  let {
    options,
    value,
    onChange,
    size = "md",
    fill = false,
    role = "tablist",
    label,
  }: Props = $props();
  const lg = $derived(size === "md");
</script>

{#snippet extras(o: Segment<string>)}
  {#if o.dot}<span class="size-1.5 rounded-full bg-warning" aria-hidden="true"></span><span
      class="sr-only">needs attention</span
    >{/if}
  {#if o.count !== undefined}
    {#if o.alert}
      <Badge variant="warning" size="sm"
        >{o.count}<span class="sr-only">{" need attention"}</span></Badge
      >
    {:else}
      <span class="font-mono text-xs text-muted-foreground tabular-nums">{o.count}</span>
    {/if}
  {/if}
{/snippet}

{#if role === "tablist"}
  <Tabs.Root {value} onValueChange={(v) => onChange(v as Id)} class={cn(fill && "w-full")}>
    <Tabs.List size={lg ? "lg" : "default"} aria-label={label} class={cn(fill && "w-full")}>
      {#each options as o (o.id)}
        <Tabs.Trigger
          value={o.id}
          disabled={o.disabled}
          class={cn(fill && "flex-1 justify-center")}
        >
          {o.label}{@render extras(o)}
        </Tabs.Trigger>
      {/each}
    </Tabs.List>
  </Tabs.Root>
{:else}
  <!-- bits-ui gives the group role="group" and each item role="radio"; the wrapper names the radiogroup. -->
  <div role="radiogroup" aria-label={label} class={cn("inline-flex", fill && "w-full")}>
    <ToggleGroup.Root
      type="single"
      {value}
      onValueChange={(v) => v && onChange(v as Id)}
      size={lg ? "lg" : "default"}
      class={cn(fill && "w-full")}
    >
      {#each options as o (o.id)}
        <ToggleGroup.Item value={o.id} disabled={o.disabled} class={cn(fill && "flex-1")}>
          {o.label}{@render extras(o)}
        </ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>
  </div>
{/if}
