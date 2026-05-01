import type { ToolAdapter } from "./types";
import { shellSafe } from "./types";

export const claudeCodeAdapter: ToolAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  supportsStreamJson: true,
  perTurnInvocation: true,

  buildNewSessionCommand() {
    const toolSessionId = crypto.randomUUID();
    return { command: "", toolSessionId };
  },

  buildResumeCommand() {
    return { command: "", useStreamJson: true };
  },

  buildSendCommand({ message, toolSessionId, isFirstTurn, settings }) {
    const parts = ["claude", "--print", "--output-format stream-json", "--include-partial-messages", "--verbose"];
    if (isFirstTurn) {
      parts.push(`--session-id ${shellSafe(toolSessionId)}`);
    } else {
      parts.push(`--resume ${shellSafe(toolSessionId)}`);
    }
    if (settings.skipPermissions) {
      parts.push("--dangerously-skip-permissions");
    }
    parts.push(`-- ${shellSafe(message)}`);
    return parts.join(" ") + "\n";
  },

  hooks: {
    type: "config-file",
    installer: "claude-hooks",
    scripts: [
      { scriptName: "atlas-notify-hook.sh", hookEvent: "Notification" },
    ],
  },

  settingsSchema: [
    {
      key: "skipPermissions",
      label: "Skip Permissions",
      description: "Launch sessions with --dangerously-skip-permissions",
      type: "boolean",
      defaultValue: false,
      dangerous: true,
    },
  ],
};
