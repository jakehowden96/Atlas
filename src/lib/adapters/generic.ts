import type { ToolAdapter } from "./types";

export const genericAdapter: ToolAdapter = {
  id: "generic",
  displayName: "Custom Command",
  supportsStreamJson: false,

  buildNewSessionCommand({ settings }) {
    const cmd = (settings.command as string) || "bash";
    return { command: cmd + "\n" };
  },

  buildResumeCommand() {
    return null;
  },

  hooks: null,

  settingsSchema: [
    {
      key: "command",
      label: "Command",
      description: "The shell command to run when spawning a new session",
      type: "string",
      defaultValue: "",
    },
  ],

};
