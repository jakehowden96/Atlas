<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import * as Tooltip from "../tooltip/index.js";
  import * as DropdownMenu from "../dropdown-menu/index.js";
  import * as ContextMenu from "../context-menu/index.js";
  import * as Popover from "../popover/index.js";
  import { Button } from "../button/index.js";
  import { Kbd } from "../kbd/index.js";
  import Icon from "../icon/icon.svelte";

  const { Story } = defineMeta({ title: "UI/Tooltip, Menus, Popover", tags: ["autodocs"] });
</script>

<Story name="Tooltip" asChild>
  <Tooltip.Provider>
    <div class="flex h-24 items-end gap-6 pl-6">
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button variant="ghost" size="icon" aria-label="Settings" {...props}
              ><Icon name="settings" size={18} /></Button
            >
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Settings <Kbd>⌘,</Kbd></Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button variant="outline" {...props}>Hover me (400ms)</Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Opens immediately on keyboard focus</Tooltip.Content>
      </Tooltip.Root>
    </div>
  </Tooltip.Provider>
</Story>

<Story name="Dropdown menu" asChild>
  <div class="h-[300px]">
    <DropdownMenu.Root open>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button variant="ghost" size="icon" aria-label="Ticket actions" {...props}
            ><Icon name="more_horiz" size={18} /></Button
          >
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start">
        <DropdownMenu.Label>Ticket</DropdownMenu.Label>
        <DropdownMenu.Item
          ><Icon name="edit" />Change<DropdownMenu.Shortcut>E</DropdownMenu.Shortcut
          ></DropdownMenu.Item
        >
        <DropdownMenu.Item><Icon name="open_in_new" />Open in Linear</DropdownMenu.Item>
        <DropdownMenu.Item
          ><Icon name="content_copy" />Copy ID<DropdownMenu.Shortcut>⌘C</DropdownMenu.Shortcut
          ></DropdownMenu.Item
        >
        <DropdownMenu.CheckboxItem checked>Show in rail</DropdownMenu.CheckboxItem>
        <DropdownMenu.Separator />
        <DropdownMenu.Item variant="destructive"><Icon name="link_off" />Unlink</DropdownMenu.Item>
        <DropdownMenu.Item disabled><Icon name="delete" />Disabled</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
</Story>

<Story name="Context menu" asChild>
  <ContextMenu.Root>
    <ContextMenu.Trigger
      class="grid h-40 w-80 place-items-center rounded-lg border border-dashed border-input text-caption text-muted-foreground"
    >
      Right-click here
    </ContextMenu.Trigger>
    <ContextMenu.Content>
      <ContextMenu.Item
        ><Icon name="open_in_new" />Open<ContextMenu.Shortcut>⏎</ContextMenu.Shortcut
        ></ContextMenu.Item
      >
      <ContextMenu.Item><Icon name="content_copy" />Copy path</ContextMenu.Item>
      <ContextMenu.Item
        ><Icon name="edit" />Rename<ContextMenu.Shortcut>F2</ContextMenu.Shortcut></ContextMenu.Item
      >
      <ContextMenu.Separator />
      <ContextMenu.Item variant="destructive"><Icon name="delete" />Delete</ContextMenu.Item>
    </ContextMenu.Content>
  </ContextMenu.Root>
</Story>

<Story name="Popover" asChild>
  <div class="h-[220px]">
    <Popover.Root open>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button variant="outline" {...props}
            ><Icon name="notifications" size={18} />Notifications</Button
          >
        {/snippet}
      </Popover.Trigger>
      <Popover.Content align="start">
        <Popover.Header>
          <Popover.Title>Connector health</Popover.Title>
          <Popover.Description
            >GitHub and Linear are linked and polling every 60s.</Popover.Description
          >
        </Popover.Header>
        <Button size="sm" variant="outline" class="self-start">Open settings</Button>
      </Popover.Content>
    </Popover.Root>
  </div>
</Story>
