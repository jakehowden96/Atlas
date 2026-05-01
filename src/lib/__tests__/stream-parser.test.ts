import { describe, it, expect } from "vitest";
import { StreamParser, type ChatEvent } from "../stream-parser";

function collectEvents(input: string): ChatEvent[] {
  const events: ChatEvent[] = [];
  const parser = new StreamParser((e) => events.push(e));
  parser.feed(input);
  parser.flush();
  return events;
}

describe("StreamParser", () => {
  it("parses system init event", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "abc-123",
      model: "claude-sonnet-4-6",
      cwd: "/home/user/project",
      tools: ["Bash", "Edit", "Read"],
    });
    const events = collectEvents(line + "\n");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "init",
      sessionId: "abc-123",
      model: "claude-sonnet-4-6",
      cwd: "/home/user/project",
      tools: ["Bash", "Edit", "Read"],
    });
  });

  it("parses assistant text message", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_001",
        content: [{ type: "text", text: "I'll help you with that." }],
      },
    });
    const events = collectEvents(line + "\n");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "agent-text",
      text: "I'll help you with that.",
      messageId: "msg_001",
    });
  });

  it("parses assistant tool_use", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_002",
        content: [{
          type: "tool_use",
          id: "toolu_001",
          name: "Bash",
          input: { command: "ls", description: "List files" },
        }],
      },
    });
    const events = collectEvents(line + "\n");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "tool-use",
      toolName: "Bash",
      toolId: "toolu_001",
      input: { command: "ls", description: "List files" },
    });
  });

  it("parses user tool_result", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{
          tool_use_id: "toolu_001",
          type: "tool_result",
          content: "file1.ts\nfile2.ts",
          is_error: false,
        }],
      },
      tool_use_result: {
        stdout: "file1.ts\nfile2.ts",
        stderr: "",
      },
    });
    const events = collectEvents(line + "\n");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "tool-result",
      toolId: "toolu_001",
      stdout: "file1.ts\nfile2.ts",
      stderr: "",
      isError: false,
    });
  });

  it("parses result event", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "Done.",
      total_cost_usd: 0.05,
      duration_ms: 3000,
      usage: { input_tokens: 1000, output_tokens: 200 },
    });
    const events = collectEvents(line + "\n");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "result",
      text: "Done.",
      cost: 0.05,
      durationMs: 3000,
      tokenUsage: { input: 1000, output: 200 },
    });
  });

  it("handles chunked input across feed calls", () => {
    const full = JSON.stringify({ type: "system", subtype: "init", session_id: "x", model: "m", cwd: "/", tools: [] }) + "\n";
    const events: ChatEvent[] = [];
    const parser = new StreamParser((e) => events.push(e));
    parser.feed(full.slice(0, 10));
    expect(events).toHaveLength(0);
    parser.feed(full.slice(10));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("init");
  });

  it("handles multiple events in one chunk", () => {
    const line1 = JSON.stringify({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Hello" }] } });
    const line2 = JSON.stringify({ type: "assistant", message: { id: "m2", content: [{ type: "text", text: "World" }] } });
    const events = collectEvents(line1 + "\n" + line2 + "\n");
    expect(events).toHaveLength(2);
    expect((events[0] as { text: string }).text).toBe("Hello");
    expect((events[1] as { text: string }).text).toBe("World");
  });

  it("emits raw-text for non-JSON lines", () => {
    const events = collectEvents("not valid json\n");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "raw-text", text: "not valid json" });
  });

  it("handles assistant message with both text and tool_use blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_003",
        content: [
          { type: "text", text: "Let me check." },
          { type: "tool_use", id: "toolu_002", name: "Read", input: { file_path: "/src/app.ts" } },
        ],
      },
    });
    const events = collectEvents(line + "\n");
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("agent-text");
    expect(events[1].type).toBe("tool-use");
  });

  describe("perTurnMode", () => {
    function collectPerTurnEvents(input: string): ChatEvent[] {
      const events: ChatEvent[] = [];
      const parser = new StreamParser((e) => events.push(e), { perTurnMode: true });
      parser.feed(input);
      parser.flush();
      return events;
    }

    it("suppresses raw-text before first init", () => {
      const init = JSON.stringify({ type: "system", subtype: "init", session_id: "s", model: "m", cwd: "/", tools: [] });
      const events = collectPerTurnEvents("shell prompt $ \n" + init + "\n");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("init");
    });

    it("suppresses raw-text between result and next init", () => {
      const init = JSON.stringify({ type: "system", subtype: "init", session_id: "s", model: "m", cwd: "/", tools: [] });
      const result = JSON.stringify({ type: "result", result: "ok", total_cost_usd: 0.01, duration_ms: 100, usage: { input_tokens: 10, output_tokens: 5 } });
      const init2 = JSON.stringify({ type: "system", subtype: "init", session_id: "s2", model: "m", cwd: "/", tools: [] });
      const input = [init, result, "$ claude --print ...", "shell noise", init2].join("\n") + "\n";
      const events = collectPerTurnEvents(input);
      const types = events.map((e) => e.type);
      expect(types).toEqual(["init", "result", "init"]);
    });

    it("emits raw-text during a turn (between init and result)", () => {
      const init = JSON.stringify({ type: "system", subtype: "init", session_id: "s", model: "m", cwd: "/", tools: [] });
      const input = init + "\n" + "unexpected output\n";
      const events = collectPerTurnEvents(input);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("init");
      expect(events[1]).toEqual({ type: "raw-text", text: "unexpected output" });
    });

    it("does not affect non-perTurnMode parser", () => {
      const result = JSON.stringify({ type: "result", result: "ok", total_cost_usd: 0, duration_ms: 0, usage: { input_tokens: 0, output_tokens: 0 } });
      const events = collectEvents(result + "\nsome text\n");
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ type: "raw-text", text: "some text" });
    });
  });
});
