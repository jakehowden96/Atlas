<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import * as Dialog from "../dialog/index.js";
  import * as AlertDialog from "../alert-dialog/index.js";
  import * as Sheet from "../sheet/index.js";
  import * as Command from "../command/index.js";
  import * as Field from "../field/index.js";
  import { Input } from "../input/index.js";
  import { Button } from "../button/index.js";
  import { Kbd } from "../kbd/index.js";
  import Icon from "../icon/icon.svelte";

  const { Story } = defineMeta({
    title: "UI/Dialog, Alert dialog, Sheet, Command",
    tags: ["autodocs"],
    parameters: { layout: "fullscreen" },
  });
</script>

<script lang="ts">
  let size = $state<"sm" | "default" | "lg">("default");
</script>

<Story name="Dialog" asChild>
  <div class="relative h-[560px] p-4">
    <div class="flex gap-2">
      {#each ["sm", "default", "lg"] as const as s (s)}
        <Button variant="outline" size="sm" onclick={() => (size = s)}>{s}</Button>
      {/each}
    </div>
    <Dialog.Root open>
      <Dialog.Content {size} portalProps={{ disabled: true }} class="absolute">
        <Dialog.Header><Dialog.Title>Rename workspace</Dialog.Title></Dialog.Header>
        <Dialog.Body>
          <Dialog.Description
            >The name shows in the top bar and the jump palette. The folder on disk is not renamed.</Dialog.Description
          >
          <Field.Field>
            <Field.Label for="dn">Name</Field.Label>
            <Input id="dn" value="atlas" />
          </Field.Field>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline">Cancel</Button>
          <Button>Rename <Kbd>⏎</Kbd></Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  </div>
</Story>

<Story name="Alert dialog" asChild>
  <div class="relative h-[400px]">
    <AlertDialog.Root open>
      <AlertDialog.Content size="sm" portalProps={{ disabled: true }} class="absolute">
        <AlertDialog.Header>
          <AlertDialog.Title>Discard 3 unsaved files?</AlertDialog.Title>
          <AlertDialog.Description
            >Changes to app.css, theme.ts and ActivityRail.svelte will be lost.</AlertDialog.Description
          >
        </AlertDialog.Header>
        <AlertDialog.Footer>
          <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
          <AlertDialog.Action>Discard</AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>
  </div>
</Story>

<Story name="Sheet" asChild>
  <div class="relative h-[560px] overflow-hidden">
    <Sheet.Root open>
      <Sheet.Content portalProps={{ disabled: true }} class="absolute">
        <Sheet.Header><Sheet.Title>Changes · 4 files</Sheet.Title></Sheet.Header>
        <Sheet.Body>
          {#each ["src/app.css", "src/lib/theme.ts", "src/lib/utils.ts", "package.json"] as f (f)}
            <div class="flex items-center gap-2 font-mono text-caption">
              <Icon name="description" />{f}
            </div>
          {/each}
        </Sheet.Body>
        <Sheet.Footer
          ><Button variant="outline">Discard all</Button><Button>Commit</Button></Sheet.Footer
        >
      </Sheet.Content>
    </Sheet.Root>
  </div>
</Story>

<Story name="Command" asChild>
  <div class="p-6">
    <Command.Root class="w-[560px] rounded-xl border border-input shadow-elev-2">
      <Command.Input placeholder="Jump to a session, file or command" />
      <Command.List>
        <Command.Empty>No matches</Command.Empty>
        <Command.Group heading="Sessions">
          <Command.Item
            ><Icon name="terminal" />feat/rail-v6<Command.Shortcut>⌘1</Command.Shortcut
            ></Command.Item
          >
          <Command.Item
            ><Icon name="terminal" />fix/oauth-loopback<Command.Shortcut>⌘2</Command.Shortcut
            ></Command.Item
          >
        </Command.Group>
        <Command.Group heading="Commands">
          <Command.Item
            ><Icon name="add" />New session<Command.Shortcut>⌘N</Command.Shortcut></Command.Item
          >
          <Command.Item
            ><Icon name="settings" />Settings<Command.Shortcut>⌘,</Command.Shortcut></Command.Item
          >
        </Command.Group>
      </Command.List>
      <Command.Footer>
        <span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
        <span><Kbd>⏎</Kbd> open</span>
        <span><Kbd>Esc</Kbd> close</span>
      </Command.Footer>
    </Command.Root>
  </div>
</Story>
