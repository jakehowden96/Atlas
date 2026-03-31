import type { Terminal } from "@xterm/xterm";

export interface TerminalTab {
  id: string;
  title: string;
  ptyId: number;
  terminal: Terminal;
}
