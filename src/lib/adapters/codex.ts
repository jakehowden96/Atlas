import type { ToolAdapter } from "./types";
import { shellSafe } from "./types";

export const codexAdapter: ToolAdapter = {
  id: "codex",
  displayName: "Codex",
  supportsStreamJson: true,

  buildNewSessionCommand({ settings }) {
    const parts = ["codex", "--json"];
    const approval = settings.approvalMode as string | undefined;
    if (approval && approval !== "on-request") {
      parts.push(`-a ${shellSafe(approval)}`);
    }
    if (settings.fullAuto) {
      parts.push("--full-auto");
    }
    return { command: parts.join(" ") + "\n" };
  },

  buildResumeCommand({ toolSessionId, settings }) {
    const parts = ["codex", "resume", shellSafe(toolSessionId), "--json"];
    if (settings.fullAuto) {
      parts.push("--full-auto");
    }
    return { command: parts.join(" ") + "\n" };
  },

  buildSendCommand({ message }) {
    return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: message }] } }) + "\n";
  },

  hooks: {
    type: "config-file",
    installer: "codex-hooks",
    scripts: [
      { scriptName: "atlas-hook.sh", hookEvent: "Stop" },
    ],
  },

  settingsSchema: [
    {
      key: "approvalMode",
      label: "Approval Mode",
      description: "Controls when Codex pauses for approval before running commands",
      type: "select",
      options: [
        { value: "untrusted", label: "Untrusted" },
        { value: "on-request", label: "On Request" },
        { value: "never", label: "Never" },
      ],
      defaultValue: "on-request",
    },
    {
      key: "fullAuto",
      label: "Full Auto",
      description: "Launch sessions with --full-auto (skip approvals, workspace-write sandbox)",
      type: "boolean",
      defaultValue: false,
      dangerous: true,
    },
  ],

};
