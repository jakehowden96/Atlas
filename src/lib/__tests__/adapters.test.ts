import { describe, it, expect } from "vitest";
import { getAdapter, listAdapters } from "../adapters";
import { claudeCodeAdapter } from "../adapters/claude-code";
import { codexAdapter } from "../adapters/codex";
import { genericAdapter } from "../adapters/generic";
import { shellSafe } from "../adapters/types";

describe("getAdapter", () => {
  it("returns claude-code adapter by id", () => {
    expect(getAdapter("claude-code")).toBe(claudeCodeAdapter);
  });

  it("returns codex adapter by id", () => {
    expect(getAdapter("codex")).toBe(codexAdapter);
  });

  it("returns generic adapter by id", () => {
    expect(getAdapter("generic")).toBe(genericAdapter);
  });

  it("falls back to generic for unknown ids", () => {
    expect(getAdapter("nonexistent")).toBe(genericAdapter);
  });
});

describe("listAdapters", () => {
  it("returns all registered adapters", () => {
    const adapters = listAdapters();
    expect(adapters).toHaveLength(3);
    expect(adapters.map((a) => a.id)).toEqual(["claude-code", "codex", "generic"]);
  });
});

describe("shellSafe", () => {
  it("passes through safe values unchanged", () => {
    expect(shellSafe("abc-123")).toBe("abc-123");
    expect(shellSafe("a_b.c")).toBe("a_b.c");
    expect(shellSafe("untrusted")).toBe("untrusted");
  });

  it("quotes values with spaces", () => {
    expect(shellSafe("hello world")).toBe("'hello world'");
  });

  it("escapes single quotes inside values", () => {
    expect(shellSafe("it's")).toBe("'it'\\''s'");
  });

  it("quotes shell metacharacters", () => {
    expect(shellSafe("; rm -rf /")).toBe("'; rm -rf /'");
    expect(shellSafe("$(whoami)")).toBe("'$(whoami)'");
    expect(shellSafe("a&b")).toBe("'a&b'");
  });

  it("passes UUIDs unchanged", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(shellSafe(uuid)).toBe(uuid);
  });
});

describe("claudeCodeAdapter", () => {
  it("is marked as per-turn invocation", () => {
    expect(claudeCodeAdapter.perTurnInvocation).toBe(true);
  });

  it("supports stream JSON", () => {
    expect(claudeCodeAdapter.supportsStreamJson).toBe(true);
  });

  it("buildNewSessionCommand returns empty command with toolSessionId", () => {
    const result = claudeCodeAdapter.buildNewSessionCommand({
      sessionId: "tab-1",
      settings: {},
    });
    expect(result.command).toBe("");
    expect(result.toolSessionId).toBeDefined();
    expect(result.toolSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("buildResumeCommand returns empty command with useStreamJson true", () => {
    const result = claudeCodeAdapter.buildResumeCommand({
      toolSessionId: "sess-abc",
      settings: {},
    });
    expect(result).not.toBeNull();
    expect(result!.command).toBe("");
    expect(result!.useStreamJson).toBe(true);
  });

  describe("buildSendCommand", () => {
    it("builds first turn with --session-id", () => {
      const cmd = claudeCodeAdapter.buildSendCommand!({
        message: "hello",
        toolSessionId: "abc-123",
        isFirstTurn: true,
        settings: {},
      });
      expect(cmd).toContain("claude");
      expect(cmd).toContain("--print");
      expect(cmd).toContain("--output-format stream-json");
      expect(cmd).toContain("--include-partial-messages");
      expect(cmd).toContain("--verbose");
      expect(cmd).toContain("--session-id abc-123");
      expect(cmd).not.toContain("--resume");
      expect(cmd).toContain("-- hello");
      expect(cmd.endsWith("\n")).toBe(true);
    });

    it("builds subsequent turn with --resume", () => {
      const cmd = claudeCodeAdapter.buildSendCommand!({
        message: "follow up",
        toolSessionId: "abc-123",
        isFirstTurn: false,
        settings: {},
      });
      expect(cmd).toContain("--resume abc-123");
      expect(cmd).not.toContain("--session-id");
      expect(cmd).toContain("-- 'follow up'");
    });

    it("includes --dangerously-skip-permissions when set", () => {
      const cmd = claudeCodeAdapter.buildSendCommand!({
        message: "test",
        toolSessionId: "abc-123",
        isFirstTurn: true,
        settings: { skipPermissions: true },
      });
      expect(cmd).toContain("--dangerously-skip-permissions");
    });

    it("escapes messages with special characters", () => {
      const cmd = claudeCodeAdapter.buildSendCommand!({
        message: "it's a $(test) & more",
        toolSessionId: "abc-123",
        isFirstTurn: true,
        settings: {},
      });
      expect(cmd).toContain("-- 'it'\\''s a $(test) & more'");
    });

    it("does not include --input-format", () => {
      const cmd = claudeCodeAdapter.buildSendCommand!({
        message: "hello",
        toolSessionId: "abc-123",
        isFirstTurn: true,
        settings: {},
      });
      expect(cmd).not.toContain("--input-format");
    });
  });
});

describe("codexAdapter", () => {
  it("builds new session command with json flag", () => {
    const result = codexAdapter.buildNewSessionCommand({
      sessionId: "tab-1",
      settings: {},
    });
    expect(result.command).toContain("codex --json");
    expect(result.command).not.toContain("-a");
  });

  it("adds approval mode when not on-request", () => {
    const result = codexAdapter.buildNewSessionCommand({
      sessionId: "tab-1",
      settings: { approvalMode: "never" },
    });
    expect(result.command).toContain("-a never");
  });

  it("omits approval mode for on-request (default)", () => {
    const result = codexAdapter.buildNewSessionCommand({
      sessionId: "tab-1",
      settings: { approvalMode: "on-request" },
    });
    expect(result.command).not.toContain("-a");
  });

  it("adds full-auto flag", () => {
    const result = codexAdapter.buildNewSessionCommand({
      sessionId: "tab-1",
      settings: { fullAuto: true },
    });
    expect(result.command).toContain("--full-auto");
  });

  it("builds resume command", () => {
    const result = codexAdapter.buildResumeCommand({
      toolSessionId: "sess-123",
      settings: {},
    });
    expect(result).not.toBeNull();
    expect(result!.command).toContain("codex resume sess-123 --json");
  });

  it("is not per-turn invocation", () => {
    expect(codexAdapter.perTurnInvocation).toBeFalsy();
  });
});

describe("genericAdapter", () => {
  it("uses bash as default command", () => {
    const result = genericAdapter.buildNewSessionCommand({
      sessionId: "tab-1",
      settings: {},
    });
    expect(result.command).toBe("bash\n");
  });

  it("uses custom command from settings", () => {
    const result = genericAdapter.buildNewSessionCommand({
      sessionId: "tab-1",
      settings: { command: "fish" },
    });
    expect(result.command).toBe("fish\n");
  });

  it("resume returns null", () => {
    expect(genericAdapter.buildResumeCommand({ toolSessionId: "x", settings: {} })).toBeNull();
  });

  it("does not support stream JSON", () => {
    expect(genericAdapter.supportsStreamJson).toBe(false);
  });

  it("is not per-turn invocation", () => {
    expect(genericAdapter.perTurnInvocation).toBeFalsy();
  });
});
