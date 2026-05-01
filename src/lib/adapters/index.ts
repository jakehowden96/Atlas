import { claudeCodeAdapter } from "./claude-code";
import { codexAdapter } from "./codex";
import { genericAdapter } from "./generic";
import type { ToolAdapter } from "./types";

const adapters: ToolAdapter[] = [
  claudeCodeAdapter,
  codexAdapter,
  genericAdapter,
];

const adapterMap = new Map(adapters.map((a) => [a.id, a]));

export function getAdapter(id: string): ToolAdapter {
  return adapterMap.get(id) ?? genericAdapter;
}

export function listAdapters(): ToolAdapter[] {
  return adapters;
}

export { claudeCodeAdapter, codexAdapter, genericAdapter };
export type { ToolAdapter, ToolSettings } from "./types";
