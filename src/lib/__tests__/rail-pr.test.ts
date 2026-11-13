// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import { flushSync } from "svelte";
import type { Check } from "../../types/generated/Check";
import type { ConnectorState } from "../../types/generated/ConnectorState";

vi.mock("../ipc", () => ({
  setClaudeHook: vi.fn(),
  startSessionTail: vi.fn(),
  stopSessionTail: vi.fn(),
  stateLoad: vi.fn(async () => ({ contents: null, recovered: false })),
  stateSave: vi.fn(async () => undefined),
  listWorkspaceRepos: vi.fn(async () => []),
}));

const refresh = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../stores/prs", async (orig) => ({
  ...(await orig<typeof import("../stores/prs")>()),
  refreshPrsForBranch: refresh,
  loadWorkspaceRepos: vi.fn(async () => undefined),
}));

import PrTile from "../components/session/rail/PrTile.svelte";
import {
  prHeadline,
  prHeadlineText,
  prPollLine,
  prRows,
  prState,
  type RailPr,
} from "../session-view";
import { connectors } from "../stores/connectors";
import { prRepos, reposByWorkspace, type Pr } from "../stores/prs";
import { railTiles } from "../stores/settings";

const chk = (name: string, status: Check["status"]): Check => ({
  name,
  status,
  detailsUrl: `https://ci/${name}`,
});
const pr = (over: Partial<RailPr> = {}): RailPr => ({
  number: 482,
  title: "Retry-After",
  state: "open",
  checks: [],
  review: { kind: "awaiting" },
  ...over,
});
const seven = [chk("a", "fail"), ...["b", "c", "d", "e", "f", "g"].map((n) => chk(n, "pass"))];

describe("prHeadline", () => {
  it("joins number, CI and review phrases", () => {
    const p = pr({ checks: seven, review: { kind: "comments", count: 3 } });
    expect(prHeadlineText(p)).toBe("#482 open, 1 of 7 checks failing, 3 review comments");
    expect(prHeadline(p).map((x) => x.tone)).toEqual(["text", "danger", "warn"]);
  });

  it("covers CI phrases", () => {
    const running = pr({ checks: [chk("a", "pending"), chk("b", "pass")] });
    expect(prHeadline(running)[1]).toEqual({ text: "1 of 2 checks running", tone: "accent" });
    const passed = pr({ checks: [chk("a", "pass")] });
    expect(prHeadline(passed)[1]).toEqual({ text: "1 check passed", tone: "muted" });
    expect(prHeadline(pr())).toHaveLength(2);
  });

  it("covers review phrases and draft or merged", () => {
    expect(prHeadline(pr({ review: { kind: "changes" } }))[1]).toEqual({
      text: "changes requested",
      tone: "warn",
    });
    expect(prHeadline(pr({ review: { kind: "approved" } }))[1]).toEqual({
      text: "approved",
      tone: "accent",
    });
    expect(prHeadline(pr({ review: { kind: "comments", count: 1 } }))[1]?.text).toBe(
      "1 review comment",
    );
    expect(prHeadline(pr({ state: "draft" }))[0]?.tone).toBe("muted");
    expect(prHeadline(pr({ state: "merged" }))).toHaveLength(1);
  });
});

describe("prState priority", () => {
  it("orders failing, attention, running, done, idle", () => {
    expect(prState(null, false)).toBe("idle");
    expect(prState(pr({ checks: seven, review: { kind: "changes" } }), true)).toBe("failing");
    expect(
      prState(pr({ review: { kind: "comments", count: 2 }, checks: [chk("a", "pending")] }), false),
    ).toBe("attention");
    expect(prState(pr({ checks: [chk("a", "pending")] }), true)).toBe("attention");
    expect(prState(pr({ checks: [chk("a", "pending")] }), false)).toBe("running");
    expect(prState(pr({ state: "merged" }), false)).toBe("done");
    expect(prState(pr(), false)).toBe("idle");
  });
});

describe("prRows", () => {
  it("groups checks and puts the passed clause on the last failing row only", () => {
    const p = pr({
      checks: [chk("x", "fail"), chk("y", "fail"), chk("z", "pass"), chk("w", "pending")],
      review: { kind: "comments", count: 2 },
    });
    const rows = prRows(p, "GitHub");
    expect(rows.running.map((r) => r.title)).toEqual(["w"]);
    expect(rows.attention.map((r) => r.rest)).toEqual(["", ", 1 other check passed", ""]);
    expect(rows.attention[0]?.linkLabel).toBe("Open on GitHub");
    expect(rows.attention[0]?.href).toBe("https://ci/x");
    expect(rows.attention[2]).toMatchObject({ title: "Review", word: "2 review comments" });
    expect(rows.other).toEqual([]);
    expect(rows.done.map((r) => r.title)).toEqual(["z"]);
  });

  it("puts a quiet review in other", () => {
    expect(prRows(pr(), "G").other[0]).toMatchObject({ state: "idle", word: "awaiting review" });
    expect(prRows(pr({ review: { kind: "approved" } }), "G").other[0]).toMatchObject({
      state: "done",
      word: "approved",
    });
  });
});

describe("prPollLine", () => {
  it("reads normally and when the refresh failed", () => {
    expect(prPollLine(12_000, 0, null)).toBe("updated 12s ago");
    expect(prPollLine(180_000, 0, "GitHub")).toBe("last updated 3m ago, GitHub failed");
  });
});

describe("PrTile polling", () => {
  const linked: ConnectorState = {
    info: {
      id: "gh",
      name: "GitHub",
      kind: "pullRequests",
      flow: "browser",
      methods: ["oauth"],
      configured: true,
    },
    status: { kind: "linked", account: "me" },
    method: "oauth",
  };
  const full: Pr = {
    number: 482,
    title: "Retry-After",
    headRefName: "feat",
    checks: seven,
    review: { kind: "awaiting" },
    state: "open",
  } as unknown as Pr;

  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockClear();
    reposByWorkspace.set({ "/w": [{ path: "/w", slug: "o/r" }] });
    connectors.set([linked]);
    prRepos.set(null);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    railTiles.set({});
    prRepos.set(null);
    connectors.set([]);
  });

  it("fetches at once, every 60s, and stops on unmount", () => {
    const { unmount } = render(PrTile, { workspacePath: "/w", branch: "feat", now: 0 });
    flushSync();
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    unmount();
    vi.advanceTimersByTime(180_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("pauses while the window is hidden and resumes", () => {
    render(PrTile, { workspacePath: "/w", branch: "feat", now: 0 });
    flushSync();
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    flushSync();
    refresh.mockClear();
    vi.advanceTimersByTime(120_000);
    expect(refresh).not.toHaveBeenCalled();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    flushSync();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not poll without a linked connector", () => {
    connectors.set([{ ...linked, status: { kind: "notLinked" } }]);
    render(PrTile, { workspacePath: "/w", branch: "feat", now: 0 });
    flushSync();
    vi.advanceTimersByTime(120_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText("Link GitHub →")).toBeTruthy();
  });

  it("shows the PR, then dims it with a retry footer when a refresh fails", () => {
    prRepos.set([{ repo: "o/r", prs: [full], error: null }]);
    render(PrTile, { workspacePath: "/w", branch: "feat", now: 0 });
    flushSync();
    expect(screen.getByText("#482 open")).toBeTruthy();
    prRepos.set([{ repo: "o/r", prs: [], error: { kind: "connectorRemote", message: "x" } }]);
    flushSync();
    expect(screen.getByText("#482 open")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("follows a PR URL the session printed, in another repo and branch", () => {
    prRepos.set([{ repo: "acme/web", prs: [{ ...full, headRefName: "other" }], error: null }]);
    render(PrTile, {
      workspacePath: "/w",
      branch: "",
      prUrl: "https://github.com/acme/web/pull/482",
      now: 0,
    });
    flushSync();
    expect(refresh).toHaveBeenCalledWith("acme/web", "");
    expect(screen.getByText("#482 open")).toBeTruthy();
  });

  it("says when the branch has no PR and when rate limited", () => {
    prRepos.set([{ repo: "o/r", prs: [], error: null }]);
    render(PrTile, { workspacePath: "/w", branch: "feat", now: 0 });
    flushSync();
    expect(screen.getByText("No PR for this branch yet")).toBeTruthy();
    prRepos.set([
      { repo: "o/r", prs: [], error: { kind: "connectorRateLimited", message: "x", retryAt: 1 } },
    ]);
    flushSync();
    expect(screen.getByText(/Rate limited, retrying at/)).toBeTruthy();
  });
});
