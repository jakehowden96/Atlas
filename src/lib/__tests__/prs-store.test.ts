import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

vi.mock("../ipc", () => ({
  ghViewer: vi.fn(),
  gitRemoteSlug: vi.fn(),
  listRepoPrs: vi.fn(),
}));
vi.mock("../logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { Home: 1 },
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  exists: vi.fn(),
}));

import { ghViewer, listRepoPrs } from "../ipc";
import {
  isMine,
  matchesFilter,
  needsAttention,
  needsMyReview,
  startPrPolling,
} from "../stores/prs";
import { prRefreshMinutes, watchedRepos } from "../stores/settings";
import type { Pr } from "../../types/prs";

function pr(overrides: Partial<Pr> = {}): Pr {
  return {
    number: 1,
    title: "A change",
    url: "https://github.com/o/r/pull/1",
    author: { login: "octocat" },
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    isDraft: false,
    headRefName: "feat/thing",
    ciState: "passed",
    reviewState: "none",
    reviewRequestLogins: [],
    commentsCount: 0,
    ...overrides,
  };
}

describe("prs filters", () => {
  describe("isMine", () => {
    it("matches the viewer's own PRs", () => {
      expect(isMine(pr({ author: { login: "octocat" } }), "octocat")).toBe(true);
    });

    it("rejects other people's PRs", () => {
      expect(isMine(pr({ author: { login: "hubot" } }), "octocat")).toBe(false);
    });

    it("is false with no viewer", () => {
      expect(isMine(pr(), null)).toBe(false);
    });
  });

  describe("needsMyReview", () => {
    it("matches an explicit review request for the viewer", () => {
      const p = pr({ author: { login: "hubot" }, reviewRequestLogins: ["octocat", "dependabot"] });
      expect(needsMyReview(p, "octocat")).toBe(true);
    });

    it("ignores requests aimed at someone else", () => {
      const p = pr({ author: { login: "hubot" }, reviewRequestLogins: ["dependabot"] });
      expect(needsMyReview(p, "octocat")).toBe(false);
    });

    it("never asks the viewer to review their own PR", () => {
      const p = pr({ author: { login: "octocat" }, reviewRequestLogins: ["octocat"] });
      expect(needsMyReview(p, "octocat")).toBe(false);
    });

    it("does not fall back to review_required without a request", () => {
      const p = pr({ author: { login: "hubot" }, reviewState: "review_required" });
      expect(needsMyReview(p, "octocat")).toBe(false);
    });

    it("is false with no viewer", () => {
      expect(needsMyReview(pr({ reviewRequestLogins: ["octocat"] }), null)).toBe(false);
    });
  });

  describe("matchesFilter", () => {
    const mine = pr({ author: { login: "octocat" } });
    const theirs = pr({ author: { login: "hubot" }, reviewRequestLogins: ["octocat"] });

    it("lets everything through on All", () => {
      expect(matchesFilter(mine, "all", "octocat")).toBe(true);
      expect(matchesFilter(theirs, "all", "octocat")).toBe(true);
    });

    it("keeps All working with no viewer", () => {
      expect(matchesFilter(mine, "all", null)).toBe(true);
    });

    it("narrows to the viewer's PRs on Mine", () => {
      expect(matchesFilter(mine, "mine", "octocat")).toBe(true);
      expect(matchesFilter(theirs, "mine", "octocat")).toBe(false);
    });

    it("narrows to requested reviews on Needs my review", () => {
      expect(matchesFilter(theirs, "review", "octocat")).toBe(true);
      expect(matchesFilter(mine, "review", "octocat")).toBe(false);
    });
  });

  describe("needsAttention", () => {
    it("flags a required review", () => {
      expect(needsAttention(pr({ reviewState: "review_required" }))).toBe(true);
    });

    it("flags requested changes", () => {
      expect(needsAttention(pr({ reviewState: "changes_requested" }))).toBe(true);
    });

    it("flags failing CI", () => {
      expect(needsAttention(pr({ ciState: "failed" }))).toBe(true);
    });

    it("ignores a healthy, approved PR", () => {
      expect(needsAttention(pr({ ciState: "passed", reviewState: "approved" }))).toBe(false);
    });

    it("ignores pending CI on its own", () => {
      expect(needsAttention(pr({ ciState: "pending", reviewState: "none" }))).toBe(false);
    });

    it("does not depend on the viewer", () => {
      const p = pr({ author: { login: "someone-else" }, ciState: "failed" });
      expect(needsAttention(p)).toBe(true);
    });
  });
});

describe("pr polling", () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(ghViewer).mockResolvedValue(null);
    vi.mocked(listRepoPrs).mockResolvedValue([]);
    vi.mocked(listRepoPrs).mockClear();
    watchedRepos.set([]);
    prRefreshMinutes.set(3);
  });

  afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
  });

  it("fetches once immediately, then on the configured interval", () => {
    stop = startPrPolling();
    expect(listRepoPrs).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3 * 60_000);
    expect(listRepoPrs).toHaveBeenCalledTimes(2);
  });

  it("re-arms the timer when the interval setting changes", () => {
    stop = startPrPolling();
    vi.mocked(listRepoPrs).mockClear();
    prRefreshMinutes.set(1);
    vi.advanceTimersByTime(60_000);
    expect(listRepoPrs).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when the watched repo list changes", () => {
    stop = startPrPolling();
    vi.mocked(listRepoPrs).mockClear();
    watchedRepos.set(["owner/repo"]);
    expect(listRepoPrs).toHaveBeenCalledWith(["owner/repo"]);
  });

  it("stops polling once torn down", () => {
    startPrPolling()();
    vi.mocked(listRepoPrs).mockClear();
    vi.advanceTimersByTime(30 * 60_000);
    expect(listRepoPrs).not.toHaveBeenCalled();
  });
});
