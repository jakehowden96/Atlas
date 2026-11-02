import linear from "../assets/connectors/linear.svg?raw";
import github from "../assets/connectors/github.svg?raw";

/** The only place in the frontend that names a provider. */
const LOGOS: Record<string, string> = { linear, github };

/** Inline SVG markup for a connector id, or undefined when it has no logo. */
export function connectorLogo(id: string): string | undefined {
  return LOGOS[id];
}
