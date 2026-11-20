<script module lang="ts">
  export interface SelectOption {
    id: string;
    label: string;
    disabled?: boolean;
  }
</script>

<script lang="ts">
  /** shadcn Select over a flat {id, label} option list. */
  import * as Select from "$lib/components/ui/select/index.js";
  import { cn } from "$lib/utils.js";

  let {
    options,
    value = $bindable(""),
    onChange,
    placeholder = "Choose…",
    size = "default",
    "aria-label": ariaLabel,
    class: className,
  }: {
    options: SelectOption[];
    value?: string;
    onChange?: (id: string) => void;
    placeholder?: string;
    size?: "sm" | "default";
    "aria-label"?: string;
    class?: string;
  } = $props();

  const current = $derived(options.find((o) => o.id === value));
</script>

<Select.Root
  type="single"
  {value}
  onValueChange={(v) => {
    value = v;
    onChange?.(v);
  }}
>
  <Select.Trigger {size} aria-label={ariaLabel} class={cn("w-fit", className)}>
    <span class={current ? "truncate" : "truncate text-muted-foreground"}>{current?.label ?? placeholder}</span>
  </Select.Trigger>
  <Select.Content>
    {#each options as o (o.id)}
      <Select.Item value={o.id} label={o.label} disabled={o.disabled} />
    {/each}
  </Select.Content>
</Select.Root>
