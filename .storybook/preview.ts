import "../src/app.css";
import { withThemeByDataAttribute } from "@storybook/addon-themes";
import type { Preview } from "@storybook/svelte";

const preview: Preview = {
  decorators: [
    withThemeByDataAttribute({
      themes: { light: "light", dark: "dark" },
      defaultTheme: "light",
      attributeName: "data-theme",
    }),
  ],
  parameters: {
    layout: "padded",
    backgrounds: { disable: true },
    a11y: { test: "todo" },
    options: {
      storySort: {
        // Matches the design's page order: theme first, then base components, then app components.
        order: [
          "UI",
          [
            "Theme",
            "Button",
            "Form controls",
            "Badge, Kbd",
            "Alert, Sonner",
            "Tooltip, Menus, Popover",
            "Tabs, Toggle group, Item, Separator",
            "Empty, Skeleton, Spinner, Progress",
            "Card, Table, Avatar, Collapsible",
            "Dialog, Alert dialog, Sheet, Command",
          ],
          "App",
          "Screens",
        ],
      },
    },
  },
};
export default preview;
