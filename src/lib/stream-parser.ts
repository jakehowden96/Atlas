export type ChatEvent =
  | { type: "init"; sessionId: string; model: string; cwd: string; tools: string[] }
  | { type: "agent-text"; text: string; messageId: string }
  | { type: "agent-text-delta"; delta: string; messageId: string }
  | { type: "tool-use"; toolName: string; toolId: string; input: Record<string, unknown> }
  | { type: "tool-result"; toolId: string; stdout: string; stderr: string; isError: boolean }
  | { type: "result"; text: string; cost: number; durationMs: number; tokenUsage: { input: number; output: number } }
  | { type: "raw-text"; text: string };

export class StreamParser {
  private buffer = "";
  private readonly onEvent: (event: ChatEvent) => void;
  private readonly perTurnMode: boolean;
  private suppressRawText = false;

  constructor(onEvent: (event: ChatEvent) => void, opts?: { perTurnMode?: boolean }) {
    this.onEvent = onEvent;
    this.perTurnMode = opts?.perTurnMode ?? false;
    this.suppressRawText = this.perTurnMode;
  }

  feed(chunk: string) {
    this.buffer += chunk;
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (line.length > 0) {
        this.parseLine(line);
      }
    }
  }

  private parseLine(line: string) {
    if (line.charCodeAt(0) !== 123) {
      if (!this.suppressRawText) {
        this.onEvent({ type: "raw-text", text: line });
      }
      return;
    }

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(line);
    } catch {
      if (!this.suppressRawText) {
        this.onEvent({ type: "raw-text", text: line });
      }
      return;
    }

    const msgType = json.type as string;

    if (msgType === "system" && json.subtype === "init") {
      if (this.perTurnMode) this.suppressRawText = false;
      this.onEvent({
        type: "init",
        sessionId: (json.session_id as string) ?? "",
        model: (json.model as string) ?? "",
        cwd: (json.cwd as string) ?? "",
        tools: (json.tools as string[]) ?? [],
      });
      return;
    }

    if (msgType === "assistant") {
      const msg = json.message as Record<string, unknown> | undefined;
      if (!msg) return;
      const content = msg.content as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(content)) return;
      const messageId = (msg.id as string) ?? "";

      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
          this.onEvent({ type: "agent-text", text: block.text, messageId });
        } else if (block.type === "content_block_delta") {
          const delta = block.delta as Record<string, unknown> | undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            this.onEvent({ type: "agent-text-delta", delta: delta.text, messageId });
          }
        } else if (block.type === "tool_use") {
          this.onEvent({
            type: "tool-use",
            toolName: (block.name as string) ?? "",
            toolId: (block.id as string) ?? "",
            input: (block.input as Record<string, unknown>) ?? {},
          });
        }
      }
      return;
    }

    if (msgType === "user") {
      const msg = json.message as Record<string, unknown> | undefined;
      if (!msg) return;
      const content = msg.content as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(content)) return;

      for (const block of content) {
        if (block.type === "tool_result") {
          const toolResult = json.tool_use_result as Record<string, unknown> | undefined;
          this.onEvent({
            type: "tool-result",
            toolId: (block.tool_use_id as string) ?? "",
            stdout: (toolResult?.stdout as string) ?? (block.content as string) ?? "",
            stderr: (toolResult?.stderr as string) ?? "",
            isError: (block.is_error as boolean) ?? false,
          });
        }
      }
      return;
    }

    if (msgType === "result") {
      const usage = json.usage as Record<string, unknown> | undefined;
      this.onEvent({
        type: "result",
        text: (json.result as string) ?? "",
        cost: (json.total_cost_usd as number) ?? 0,
        durationMs: (json.duration_ms as number) ?? 0,
        tokenUsage: {
          input: (usage?.input_tokens as number) ?? 0,
          output: (usage?.output_tokens as number) ?? 0,
        },
      });
      if (this.perTurnMode) this.suppressRawText = true;
      return;
    }

    if (!this.suppressRawText) {
      this.onEvent({ type: "raw-text", text: line });
    }
  }

  flush() {
    const remaining = this.buffer.trim();
    if (remaining.length > 0) {
      this.parseLine(remaining);
    }
    this.buffer = "";
  }
}
