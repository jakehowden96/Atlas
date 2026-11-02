import type { ConnectorState } from "../types/generated/ConnectorState";

/** Provider-neutral copy: the name always comes from the connector's data. */
export function needsReconnectLabel(c: ConnectorState): string {
  return `${c.info.name} needs reconnecting`;
}

export function openOnProviderLabel(c: ConnectorState): string {
  return `Open on ${c.info.name}`;
}
