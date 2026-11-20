<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import * as Field from "../field/index.js";
  import { Input } from "../input/index.js";
  import * as InputGroup from "../input-group/index.js";
  import { Textarea } from "../textarea/index.js";
  import * as Select from "../select/index.js";
  import * as NativeSelect from "../native-select/index.js";
  import { Checkbox } from "../checkbox/index.js";
  import * as RadioGroup from "../radio-group/index.js";
  import { Switch } from "../switch/index.js";
  import { Label } from "../label/index.js";
  import Icon from "../icon/icon.svelte";
  import Kbd from "../kbd/kbd.svelte";

  const { Story } = defineMeta({ title: "UI/Form controls", tags: ["autodocs"] });

  const models = [
    { value: "opus", label: "Opus" },
    { value: "sonnet", label: "Sonnet" },
    { value: "haiku", label: "Haiku" },
  ];
</script>

<script lang="ts">
  let model = $state("sonnet");
  let saved = $state(false);
</script>

<Story name="Field and input" asChild>
  <div class="grid max-w-[360px] gap-5">
    <Field.Field>
      <Field.Label for="f1">Workspace name</Field.Label>
      <Input id="f1" value="atlas" />
      <Field.Description>Shown in the top bar and the jump palette.</Field.Description>
    </Field.Field>
    <Field.Field>
      <div class="flex items-center">
        <Field.Label for="f2">Branch prefix</Field.Label>
        <Field.Saved {saved} />
      </div>
      <Input id="f2" mono value="jake/" onblur={() => (saved = !saved)} />
      <Field.Description>Blur to commit; a tick shows for 2s.</Field.Description>
    </Field.Field>
    <Field.Field>
      <Field.Label for="f3">Repository</Field.Label>
      <Input id="f3" aria-invalid="true" value="jakehowden/atlas.git" />
      <Field.Error>Not a GitHub repository URL.</Field.Error>
    </Field.Field>
    <Field.Field>
      <Field.Label for="f4">Disabled</Field.Label>
      <Input id="f4" disabled value="Managed by your organisation" />
    </Field.Field>
    <Field.Field>
      <Field.Label for="f5">Placeholder</Field.Label>
      <Input id="f5" placeholder="Search files" />
    </Field.Field>
  </div>
</Story>

<Story name="Input group and textarea" asChild>
  <div class="grid max-w-[420px] gap-5">
    <InputGroup.Root>
      <InputGroup.Addon><Icon name="search" /></InputGroup.Addon>
      <InputGroup.Input placeholder="Filter pull requests" />
      <InputGroup.Addon align="inline-end"><Kbd>/</Kbd></InputGroup.Addon>
    </InputGroup.Root>
    <InputGroup.Root data-size="lg">
      <InputGroup.Addon><Icon name="search" size={18} /></InputGroup.Addon>
      <InputGroup.Input placeholder="Jump to a session, file or command" />
    </InputGroup.Root>
    <Field.Field>
      <Field.Label for="t1">Comment</Field.Label>
      <Textarea id="t1" counter maxlength={280} value="This should handle the empty worktree case." />
    </Field.Field>
  </div>
</Story>

<Story name="Select" asChild>
  <div class="grid max-w-[260px] gap-5">
    <Field.Field>
      <Field.Label>Model</Field.Label>
      <Select.Root type="single" bind:value={model}>
        <Select.Trigger>{models.find((m) => m.value === model)?.label}</Select.Trigger>
        <Select.Content>
          <Select.Label>Claude</Select.Label>
          {#each models as m (m.value)}
            <Select.Item value={m.value} label={m.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </Field.Field>
    <Field.Field>
      <Field.Label>Native select</Field.Label>
      <NativeSelect.Root>
        {#each models as m (m.value)}<NativeSelect.Option value={m.value}>{m.label}</NativeSelect.Option>{/each}
      </NativeSelect.Root>
    </Field.Field>
    <Select.Root type="single" open value="sonnet">
      <Select.Trigger>Sonnet (open)</Select.Trigger>
      <Select.Content>
        {#each models as m (m.value)}<Select.Item value={m.value} label={m.label} />{/each}
      </Select.Content>
    </Select.Root>
  </div>
</Story>

<Story name="Choices" asChild>
  <div class="grid gap-6">
    <div class="flex flex-wrap items-center gap-6">
      <Label class="text-sm font-normal"><Checkbox /> Unchecked</Label>
      <Label class="text-sm font-normal"><Checkbox checked /> Checked</Label>
      <Label class="text-sm font-normal"><Checkbox indeterminate /> Some files</Label>
      <Label class="text-sm font-normal"><Checkbox disabled /> Disabled</Label>
      <Label class="text-sm font-normal"><Checkbox disabled checked /> Disabled on</Label>
    </div>
    <RadioGroup.Root value="split" orientation="horizontal">
      <Label class="text-sm font-normal"><RadioGroup.Item value="unified" /> Unified</Label>
      <Label class="text-sm font-normal"><RadioGroup.Item value="split" /> Split</Label>
      <Label class="text-sm font-normal"><RadioGroup.Item value="off" disabled /> Off</Label>
    </RadioGroup.Root>
    <RadioGroup.Root value="worktree">
      <Label class="text-sm font-normal"><RadioGroup.Item value="worktree" /> New worktree</Label>
      <Label class="text-sm font-normal"><RadioGroup.Item value="branch" /> Current branch</Label>
    </RadioGroup.Root>
    <div class="flex flex-wrap items-center gap-6">
      <Label class="text-sm font-normal"><Switch /> Sounds</Label>
      <Label class="text-sm font-normal"><Switch checked /> Notifications</Label>
      <Label class="text-sm font-normal"><Switch disabled /> Disabled</Label>
    </div>
  </div>
</Story>
