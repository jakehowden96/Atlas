import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({
  ghViewer: vi.fn(),
  listWorkspaceRepos: vi.fn(),
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

import { ghViewer, listRepoPrs, listWorkspaceRepos } from "../ipc";
import {
  isMine,
  matchesFilter,
  loadWorkspaceRepos,
  matchRepo,
  needsAttention,
  needsMyReview,
  prRepos,
  prViewer,
  refreshPrs,
  reposByWorkspace,
  startPrPolling,
} from "../stores/prs";
import { toasts } from "../stores/toast";
import { prRefreshMinutes, watchedRepos } from "../stores/settings";
import type { Pr, RepoPrs } from "../../types/prs";

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

  it("fetches once immediately, then on the configured interval", async () => {
    stop = startPrPolling();
    expect(listRepoPrs).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(listRepoPrs).toHaveBeenCalledTimes(2);
  });

  it("re-arms the timer when the interval setting changes", async () => {
    stop = startPrPolling();
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(listRepoPrs).mockClear();
    prRefreshMinutes.set(1);
    await vi.advanceTimersByTimeAsync(60_000);
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

describe("matchRepo", () => {
  // A workspace that is itself a checkout, and one that holds two.
  const byWorkspace = {
    "/home/me/atlas": [{ path: "/home/me/atlas", slug: "jake/atlas" }],
    "/home/me/work": [
      { path: "/home/me/work/api", slug: "acme/api" },
      { path: "/home/me/work/web", slug: "acme/web" },
    ],
  };

  it("returns the workspace itself when the workspace is the repo", () => {
    expect(matchRepo(byWorkspace, "jake/atlas")).toEqual({
      repoPath: "/home/me/atlas",
      workspacePath: "/home/me/atlas",
    });
  });

  it("finds a repo one directory inside a workspace", () => {
    // The bug: only the workspace root was asked for a remote, so a PR on a
    // repo discovered inside one had nowhere to start a session.
    expect(matchRepo(byWorkspace, "acme/web")).toEqual({
      repoPath: "/home/me/work/web",
      workspacePath: "/home/me/work",
    });
  });

  it("matches a slug regardless of case", () => {
    expect(matchRepo(byWorkspace, "ACME/Api")?.repoPath).toBe("/home/me/work/api");
  });

  it("is null for a repo no workspace holds", () => {
    expect(matchRepo(byWorkspace, "someone/else")).toBe(null);
    expect(matchRepo({}, "jake/atlas")).toBe(null);
  });

  it("ignores a repo with no remote", () => {
    const noRemote = { "/home/me/scratch": [{ path: "/home/me/scratch", slug: null }] };
    expect(matchRepo(noRemote, "jake/atlas")).toBe(null);
  });
});

describe("pr refresh", () => {
  let stop: (() => void) | null = null;

  function repoPrs(repo: string): RepoPrs[] {
    return [{ repo, prs: [pr()], error: null }];
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.mocked(ghViewer).mockReset();
    vi.mocked(ghViewer).mockResolvedValue(null);
    vi.mocked(listRepoPrs).mockReset();
    vi.mocked(listRepoPrs).mockResolvedValue([]);
    vi.mocked(listWorkspaceRepos).mockReset();
    vi.mocked(listWorkspaceRepos).mockResolvedValue([]);
    watchedRepos.set([]);
    prRefreshMinutes.set(3);
    reposByWorkspace.set({});
    prRepos.set(null);
    // The store remembers whether its last refresh failed; start from a good one.
    await refreshPrs();
    vi.mocked(listRepoPrs).mockClear();
    vi.mocked(ghViewer).mockClear();
    prRepos.set(null);
    prViewer.set(null);
    toasts.set([]);
  });

  afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
  });

  it("does not refetch when only the resolved workspace remotes changed", async () => {
    stop = startPrPolling();
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(listRepoPrs).mockClear();

    reposByWorkspace.set({ "/w": [] });
    await vi.advanceTimersByTimeAsync(0);

    expect(listRepoPrs).not.toHaveBeenCalled();
  });

  it("keeps the newest result when an older request answers last", async () => {
    let answerFirst: (value: RepoPrs[]) => void = () => {};
    vi.mocked(listRepoPrs)
      .mockReturnValueOnce(
        new Promise<RepoPrs[]>((resolve) => {
          answerFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(repoPrs("new/repo"));

    const first = refreshPrs();
    await refreshPrs();
    answerFirst(repoPrs("old/repo"));
    await first;

    expect(get(prRepos)?.[0].repo).toBe("new/repo");
  });

  it("does not start another poll while one is still in flight", async () => {
    let answer: (value: RepoPrs[]) => void = () => {};
    vi.mocked(listRepoPrs).mockReturnValue(
      new Promise<RepoPrs[]>((resolve) => {
        answer = resolve;
      }),
    );
    stop = startPrPolling();
    vi.mocked(listRepoPrs).mockClear();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(listRepoPrs).not.toHaveBeenCalled();

    answer([]);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(listRepoPrs).toHaveBeenCalledTimes(1);
  });

  it("toasts a failing poll once, not on every interval", async () => {
    vi.mocked(listRepoPrs).mockRejectedValue(new Error("gh: not found"));
    const shown = new Set<string>();
    const unsubscribe = toasts.subscribe((list) => {
      for (const t of list) shown.add(t.id);
    });
    stop = startPrPolling();

    await vi.advanceTimersByTimeAsync(3 * 3 * 60_000);
    unsubscribe();

    expect(listRepoPrs).toHaveBeenCalledTimes(4);
    expect(shown.size).toBe(1);
  });

  it("toasts again after a success followed by a new failure", async () => {
    vi.mocked(listRepoPrs)
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("down again"));
    const shown = new Set<string>();
    const unsubscribe = toasts.subscribe((list) => {
      for (const t of list) shown.add(t.id);
    });
    stop = startPrPolling();

    await vi.advanceTimersByTimeAsync(2 * 3 * 60_000 + 1000);
    unsubscribe();

    expect(shown.size).toBe(2);
  });

  it("picks the viewer up on a later poll once gh is signed in", async () => {
    stop = startPrPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(get(prViewer)).toBeNull();

    vi.mocked(ghViewer).mockResolvedValue({ login: "octocat" });
    await vi.advanceTimersByTimeAsync(3 * 60_000);

    expect(get(prViewer)?.login).toBe("octocat");
  });

  it("asks git for a workspace's remotes once when two callers race", async () => {
    await Promise.all([loadWorkspaceRepos(["/w"]), loadWorkspaceRepos(["/w"])]);

    expect(listWorkspaceRepos).toHaveBeenCalledTimes(1);
  });
});
