import type { ClaudeInfo } from "../types/generated/ClaudeInfo";
import type { HookStatus } from "../types/generated/HookStatus";

export type FirstRunItemId = "claude" | "hooks" | "workspace";

export interface FirstRunItem {
  id: FirstRunItemId;
  label: string;
  done: boolean;
}

const hookCurrent = (h: HookStatus | undefined) => h?.kind === "installed" && h.upToDate;

/** The setup checklist. `claude` is null until the first `claude_info` answers
 *  (or when it failed), which reads as not found. */
export function deriveFirstRun(
  claude: ClaudeInfo | null,
  workspaceCount: number,
): { items: FirstRunItem[]; allDone: boolean } {
  const items: FirstRunItem[] = [
    { id: "claude", label: "Claude Code found", done: !!claude?.binary },
    {
      id: "hooks",
      label: "Hooks installed",
      done: hookCurrent(claude?.notificationHook) && hookCurrent(claude?.sessionStartHook),
    },
    { id: "workspace", label: "Workspace added", done: workspaceCount > 0 },
  ];
  return { items, allDone: items.every((i) => i.done) };
}
