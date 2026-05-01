export interface ToolAdapter {
  id: string;
  displayName: string;

  buildNewSessionCommand(opts: {
    sessionId: string;
    settings: ToolSettings;
  }): { command: string; toolSessionId?: string };

  buildResumeCommand(opts: {
    toolSessionId: string;
    settings: ToolSettings;
  }): { command: string; useStreamJson?: boolean } | null;

  buildSendCommand?(opts: {
    message: string;
    toolSessionId: string;
    isFirstTurn: boolean;
    settings: ToolSettings;
  }): string;

  perTurnInvocation?: boolean;

  hooks: ToolHookConfig | null;

  settingsSchema: ToolSettingDefinition[];

  supportsStreamJson: boolean;
}

export interface ToolHookConfig {
  type: "config-file";
  installer: "claude-hooks" | "codex-hooks";
  scripts: { scriptName: string; hookEvent: string }[];
}

export interface ToolSettingDefinition {
  key: string;
  label: string;
  description: string;
  type: "boolean" | "string" | "select";
  options?: { value: string; label: string }[];
  defaultValue: boolean | string;
  dangerous?: boolean;
}

export type ToolSettings = Record<string, boolean | string>;

const SAFE_ARG = /^[a-zA-Z0-9._\-/:=]+$/;

export function shellSafe(value: string): string {
  if (SAFE_ARG.test(value)) return value;
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
