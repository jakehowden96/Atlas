import { describe, it, expect, beforeEach } from "vitest";
import {
  getSessionStore,
  appendUserMessage,
  handleChatEvent,
  endStreaming,
  startStreaming,
  clearSession,
  type ChatSession,
} from "../stores/chat";

function subscribe(tabId: string): ChatSession {
  let session: ChatSession | null = null;
  const store = getSessionStore(tabId);
  store.subscribe((s) => { session = s; });
  return session!;
}

describe("chat store", () => {
  const TAB = "test-tab";

  beforeEach(() => {
    clearSession(TAB);
  });

  describe("getSessionStore", () => {
    it("creates a session with empty defaults", () => {
      const session = subscribe(TAB);
      expect(session.messages).toEqual([]);
      expect(session.streaming).toBe(false);
      expect(session.meta.sessionId).toBe("");
    });

    it("returns the same session for repeated calls", () => {
      subscribe(TAB);
      appendUserMessage(TAB, "hello");
      const s2 = subscribe(TAB);
      expect(s2.messages).toHaveLength(1);
    });
  });

  describe("appendUserMessage", () => {
    it("adds a user message", () => {
      subscribe(TAB);
      appendUserMessage(TAB, "hello");
      const session = subscribe(TAB);
      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].type).toBe("user");
      if (session.messages[0].type === "user") {
        expect(session.messages[0].text).toBe("hello");
      }
    });
  });

  describe("handleChatEvent", () => {
    it("handles init event", () => {
      subscribe(TAB);
      handleChatEvent(TAB, {
        type: "init",
        sessionId: "sess-1",
        model: "claude-sonnet-4-6",
        cwd: "/project",
        tools: ["Bash"],
      });
      const session = subscribe(TAB);
      expect(session.meta.sessionId).toBe("sess-1");
      expect(session.meta.model).toBe("claude-sonnet-4-6");
      expect(session.streaming).toBe(true);
    });

    it("handles agent-text event — creates new message", () => {
      subscribe(TAB);
      handleChatEvent(TAB, {
        type: "agent-text",
        text: "Hello there",
        messageId: "msg-1",
      });
      const session = subscribe(TAB);
      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].type).toBe("agent");
      if (session.messages[0].type === "agent") {
        expect(session.messages[0].text).toBe("Hello there");
      }
    });

    it("handles agent-text event — updates existing message with same id", () => {
      subscribe(TAB);
      handleChatEvent(TAB, { type: "agent-text", text: "First", messageId: "msg-1" });
      handleChatEvent(TAB, { type: "agent-text", text: "Updated", messageId: "msg-1" });
      const session = subscribe(TAB);
      expect(session.messages).toHaveLength(1);
      if (session.messages[0].type === "agent") {
        expect(session.messages[0].text).toBe("Updated");
      }
    });

    it("handles agent-text-delta — appends to existing message", () => {
      subscribe(TAB);
      handleChatEvent(TAB, { type: "agent-text", text: "Hello", messageId: "msg-1" });
      handleChatEvent(TAB, { type: "agent-text-delta", delta: " world", messageId: "msg-1" });
      const session = subscribe(TAB);
      expect(session.messages).toHaveLength(1);
      if (session.messages[0].type === "agent") {
        expect(session.messages[0].text).toBe("Hello world");
      }
    });

    it("handles agent-text-delta — creates new message if no matching id", () => {
      subscribe(TAB);
      handleChatEvent(TAB, { type: "agent-text-delta", delta: "partial", messageId: "msg-new" });
      const session = subscribe(TAB);
      expect(session.messages).toHaveLength(1);
      if (session.messages[0].type === "agent") {
        expect(session.messages[0].text).toBe("partial");
      }
    });

    it("handles tool-use event", () => {
      subscribe(TAB);
      handleChatEvent(TAB, {
        type: "tool-use",
        toolName: "Bash",
        toolId: "tool-1",
        input: { command: "ls" },
      });
      const session = subscribe(TAB);
      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].type).toBe("tool");
      if (session.messages[0].type === "tool") {
        expect(session.messages[0].call.toolName).toBe("Bash");
        expect(session.messages[0].call.completed).toBe(false);
      }
    });

    it("handles tool-result event — completes matching tool call", () => {
      subscribe(TAB);
      handleChatEvent(TAB, {
        type: "tool-use",
        toolName: "Bash",
        toolId: "tool-1",
        input: { command: "ls" },
      });
      handleChatEvent(TAB, {
        type: "tool-result",
        toolId: "tool-1",
        stdout: "file1.ts",
        stderr: "",
        isError: false,
      });
      const session = subscribe(TAB);
      if (session.messages[0].type === "tool") {
        expect(session.messages[0].call.completed).toBe(true);
        expect(session.messages[0].call.stdout).toBe("file1.ts");
      }
    });

    it("handles result event — updates meta and stops streaming", () => {
      subscribe(TAB);
      handleChatEvent(TAB, {
        type: "init",
        sessionId: "s1",
        model: "m",
        cwd: "/",
        tools: [],
      });
      handleChatEvent(TAB, {
        type: "result",
        text: "Done",
        cost: 0.05,
        durationMs: 3000,
        tokenUsage: { input: 100, output: 50 },
      });
      const session = subscribe(TAB);
      expect(session.streaming).toBe(false);
      expect(session.meta.cost).toBe(0.05);
      expect(session.meta.tokenUsage).toEqual({ input: 100, output: 50 });
    });

    it("handles raw-text event — appends to raw message", () => {
      subscribe(TAB);
      handleChatEvent(TAB, { type: "raw-text", text: "line 1" });
      handleChatEvent(TAB, { type: "raw-text", text: "line 2" });
      const session = subscribe(TAB);
      expect(session.messages).toHaveLength(1);
      if (session.messages[0].type === "agent") {
        expect(session.messages[0].text).toContain("line 1");
        expect(session.messages[0].text).toContain("line 2");
      }
    });
  });

  describe("endStreaming", () => {
    it("resets streaming flag to false", () => {
      subscribe(TAB);
      handleChatEvent(TAB, {
        type: "init",
        sessionId: "s1",
        model: "m",
        cwd: "/",
        tools: [],
      });
      let session = subscribe(TAB);
      expect(session.streaming).toBe(true);
      endStreaming(TAB);
      session = subscribe(TAB);
      expect(session.streaming).toBe(false);
    });
  });

  describe("startStreaming", () => {
    it("sets streaming flag to true", () => {
      subscribe(TAB);
      startStreaming(TAB);
      const session = subscribe(TAB);
      expect(session.streaming).toBe(true);
    });
  });

  describe("cost accumulation", () => {
    it("accumulates cost and tokens across multiple result events", () => {
      subscribe(TAB);
      handleChatEvent(TAB, { type: "init", sessionId: "s1", model: "m", cwd: "/", tools: [] });
      handleChatEvent(TAB, {
        type: "result",
        text: "Turn 1",
        cost: 0.05,
        durationMs: 1000,
        tokenUsage: { input: 100, output: 50 },
      });
      handleChatEvent(TAB, { type: "init", sessionId: "s1", model: "m", cwd: "/", tools: [] });
      handleChatEvent(TAB, {
        type: "result",
        text: "Turn 2",
        cost: 0.03,
        durationMs: 2000,
        tokenUsage: { input: 80, output: 30 },
      });
      const session = subscribe(TAB);
      expect(session.meta.cost).toBeCloseTo(0.08);
      expect(session.meta.durationMs).toBe(3000);
      expect(session.meta.tokenUsage).toEqual({ input: 180, output: 80 });
    });
  });

  describe("clearSession", () => {
    it("removes session data entirely", () => {
      subscribe(TAB);
      appendUserMessage(TAB, "hello");
      clearSession(TAB);
      const fresh = subscribe(TAB);
      expect(fresh.messages).toEqual([]);
    });
  });
});
