import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({
  connectorListPullRequests: vi.fn(),
  listWorkspaceRepos: vi.fn(),
}));
vi.mock("../logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import { connectorListPullRequests, listWorkspaceRepos } from "../ipc";
import { IpcError } from "../ipc-error";
import { connectors } from "../stores/connectors";
import {
  isMine,
  matchesFilter,
  prsForTicket,
  loadWorkspaceRepos,
  matchRepo,
  needsAttention,
  needsMyReview,
  prRepos,
  prSetupProblem,
  prViewer,
  refreshPrs,
  refreshPrsForBranch,
  reposByWorkspace,
  startPrPolling,
  type Pr,
} from "../stores/prs";
import { toasts } from "../stores/toast";
import { prRefreshMinutes, watchedRepos } from "../stores/settings";
import type { ConnectorState } from "../../types/generated/ConnectorState";
import type { PullRequest } from "../../types/generated/PullRequest";

const listPrs = vi.mocked(connectorListPullRequests);

function github(status: ConnectorState["status"]): ConnectorState {
  return {
    info: { id: "github", name: "GitHub", kind: "pullRequests", flow: "browser", configured: true },
    status,
  } as ConnectorState;
}
const LINKED = github({ kind: "linked", account: "octocat" });

function neutral(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1,
    title: "A change",
    url: "https://github.com/o/r/pull/1",
    state: "open",
    headRefName: "feat/thing",
    author: "octocat",
    isCrossRepository: false,
    ci: "pass",
    checks: [{ name: "build", status: "pass", detailsUrl: null }],
    review: { kind: "approved" },
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    reviewRequestLogins: ["hubot"],
    commentsCount: 3,
    ...overrides,
  };
}

function pr(overrides: Partial<Pr> = {}): Pr {
  return {
    number: 1,
    title: "A change",
    url: "https://github.com/o/r/pull/1",
    author: { login: "octocat" },
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    isDraft: false,
    isCrossRepository: false,
    headRefName: "feat/thing",
    ciState: "passed",
    reviewState: "none",
    reviewRequestLogins: [],
    commentsCount: 0,
    checks: [],
    review: { kind: "awaiting" },
    checkoutRef: { repo: "o/r", number: 1 },
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

  describe("prsForTicket", () => {
    const byBranch = pr({ number: 1, title: "Retry", headRefName: "jake/eng-42-retry" });
    const byTitle = pr({ number: 2, title: "[ENG-42] Fix", headRefName: "fix" });
    const near = pr({ number: 3, title: "ENG-421 other", headRefName: "eng-4210" });

    it("matches the id in branch or title, whole id only, across repos", () => {
      const repos = [
        { repo: "o/a", prs: [byBranch, near], error: null },
        { repo: "o/b", prs: [byTitle], error: null },
      ];
      expect(prsForTicket(repos, "ENG-42").map((m) => `${m.repo}#${m.pr.number}`)).toEqual([
        "o/a#1",
        "o/b#2",
      ]);
      expect(prsForTicket(repos, "")).toEqual([]);
      expect(prsForTicket(null, "ENG-42")).toEqual([]);
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
    connectors.set([LINKED]);
    listPrs.mockReset();
    listPrs.mockResolvedValue([]);
    watchedRepos.set(["owner/repo"]);
    prRefreshMinutes.set(3);
  });

  afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
  });

  it("fetches once immediately, then on the configured interval", async () => {
    stop = startPrPolling();
    expect(listPrs).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(listPrs).toHaveBeenCalledTimes(2);
  });

  it("re-arms the timer when the interval setting changes", async () => {
    stop = startPrPolling();
    await vi.advanceTimersByTimeAsync(0);
    listPrs.mockClear();
    prRefreshMinutes.set(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listPrs).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when the watched repo list changes", () => {
    stop = startPrPolling();
    listPrs.mockClear();
    watchedRepos.set(["owner/other"]);
    expect(listPrs).toHaveBeenCalledWith("github", [{ slug: "owner/other" }]);
  });

  it("re-fetches when the connector signs in", async () => {
    connectors.set([github({ kind: "notLinked" })]);
    stop = startPrPolling();
    listPrs.mockClear();
    connectors.set([LINKED]);
    await vi.advanceTimersByTimeAsync(0);
    expect(listPrs).toHaveBeenCalledTimes(1);
  });

  it("stops polling once torn down", () => {
    startPrPolling()();
    listPrs.mockClear();
    vi.advanceTimersByTime(30 * 60_000);
    expect(listPrs).not.toHaveBeenCalled();
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

  beforeEach(async () => {
    vi.useFakeTimers();
    connectors.set([LINKED]);
    listPrs.mockReset();
    listPrs.mockResolvedValue([]);
    vi.mocked(listWorkspaceRepos).mockReset();
    vi.mocked(listWorkspaceRepos).mockResolvedValue([]);
    watchedRepos.set(["owner/repo"]);
    prRefreshMinutes.set(3);
    reposByWorkspace.set({});
    prRepos.set(null);
    // The store remembers whether its last refresh failed; start from a good one.
    await refreshPrs();
    listPrs.mockClear();
    prRepos.set(null);
    toasts.set([]);
  });

  afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
  });

  it("maps connector pull requests onto the screen's shape, keeping per-check detail", async () => {
    listPrs.mockResolvedValue([neutral({ ci: "fail", state: "draft" })]);
    await refreshPrs();

    const [entry] = get(prRepos) ?? [];
    expect(entry?.repo).toBe("owner/repo");
    expect(entry?.prs[0]).toMatchObject({
      number: 1,
      author: { login: "octocat" },
      isDraft: true,
      ciState: "failed",
      createdAt: "2026-08-01T00:00:00Z",
      reviewState: "approved",
      review: { kind: "approved" },
      reviewRequestLogins: ["hubot"],
      commentsCount: 3,
      checks: [{ name: "build", status: "pass", detailsUrl: null }],
      checkoutRef: { repo: "owner/repo", number: 1 },
    });
  });

  it("reads the viewer from the linked connector account", () => {
    expect(get(prViewer)).toEqual({ login: "octocat" });
    connectors.set([github({ kind: "notLinked" })]);
    expect(get(prViewer)).toBeNull();
  });

  it("asks the connector one repo at a time and keeps a failing repo on its own card", async () => {
    watchedRepos.set(["a/one", "b/two"]);
    listPrs.mockImplementation(async (_id, repos) => {
      if (repos[0]?.slug === "b/two") throw new IpcError("connectorRemote", "502", { status: 502 });
      return [neutral()];
    });
    await refreshPrs();

    const [one, two] = get(prRepos) ?? [];
    expect(one?.error).toBeNull();
    expect(one?.prs).toHaveLength(1);
    expect(two?.error).toMatchObject({ kind: "connectorRemote", message: "502" });
    expect(get(prSetupProblem)).toBeNull();
    expect(get(toasts)).toHaveLength(0);
  });

  it("reports a rate limit with when to retry, and does not toast", async () => {
    listPrs.mockRejectedValue(new IpcError("connectorRateLimited", "slow down", { retryAt: 42 }));
    await refreshPrs();

    expect(get(prSetupProblem)).toEqual({ kind: "rateLimited", retryAt: 42 });
    expect(get(toasts)).toHaveLength(0);
  });

  it("reports an offline connector", async () => {
    listPrs.mockRejectedValue(new IpcError("connectorOffline", "no network"));
    await refreshPrs();
    expect(get(prSetupProblem)).toEqual({ kind: "offline" });
  });

  it("reports no connector and fetches nothing", async () => {
    connectors.set([github({ kind: "notLinked" })]);
    await refreshPrs();

    expect(listPrs).not.toHaveBeenCalled();
    expect(get(prSetupProblem)).toEqual({ kind: "noConnector" });
    expect(get(prRepos)).toEqual([]);
  });

  it("reports a connector that needs reconnecting", () => {
    connectors.set([github({ kind: "reconnectNeeded", reason: "expired" })]);
    expect(get(prSetupProblem)).toEqual({ kind: "reconnect" });
  });

  it("does not refetch when only the resolved workspace remotes changed", async () => {
    stop = startPrPolling();
    await vi.advanceTimersByTimeAsync(0);
    listPrs.mockClear();

    reposByWorkspace.set({ "/w": [] });
    await vi.advanceTimersByTimeAsync(0);

    expect(listPrs).not.toHaveBeenCalled();
  });

  it("keeps the newest result when an older request answers last", async () => {
    let answerFirst: (value: PullRequest[]) => void = () => {};
    listPrs
      .mockReturnValueOnce(
        new Promise<PullRequest[]>((resolve) => {
          answerFirst = resolve;
        }),
      )
      .mockResolvedValueOnce([neutral({ title: "new" })]);

    const first = refreshPrs();
    await refreshPrs();
    answerFirst([neutral({ title: "old" })]);
    await first;

    expect(get(prRepos)?.[0]?.prs[0]?.title).toBe("new");
  });

  it("does not start another poll while one is still in flight", async () => {
    let answer: (value: PullRequest[]) => void = () => {};
    listPrs.mockReturnValue(
      new Promise<PullRequest[]>((resolve) => {
        answer = resolve;
      }),
    );
    stop = startPrPolling();
    listPrs.mockClear();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(listPrs).not.toHaveBeenCalled();

    answer([]);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(listPrs).toHaveBeenCalledTimes(1);
  });

  it("toasts a failing poll once, not on every interval", async () => {
    listPrs.mockRejectedValue(new IpcError("connectorRemote", "bad gateway", { status: 502 }));
    const shown = new Set<string>();
    const unsubscribe = toasts.subscribe((list) => {
      for (const t of list) shown.add(t.id);
    });
    stop = startPrPolling();

    await vi.advanceTimersByTimeAsync(3 * 3 * 60_000);
    unsubscribe();

    expect(listPrs).toHaveBeenCalledTimes(4);
    expect(shown.size).toBe(1);
  });

  it("toasts again after a success followed by a new failure", async () => {
    listPrs
      .mockRejectedValueOnce(new IpcError("connectorRemote", "down", { status: 502 }))
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new IpcError("connectorRemote", "down again", { status: 502 }));
    const shown = new Set<string>();
    const unsubscribe = toasts.subscribe((list) => {
      for (const t of list) shown.add(t.id);
    });
    stop = startPrPolling();

    await vi.advanceTimersByTimeAsync(2 * 3 * 60_000 + 1000);
    unsubscribe();

    expect(shown.size).toBe(2);
  });

  it("refreshes one repo for the rail without touching the others", async () => {
    prRepos.set([
      { repo: "owner/repo", prs: [], error: null },
      { repo: "keep/me", prs: [pr()], error: null },
    ]);
    listPrs.mockResolvedValue([neutral({ title: "fresh" })]);
    await refreshPrsForBranch("owner/repo", "feat/thing");

    const all = get(prRepos) ?? [];
    expect(all[0]?.prs[0]?.title).toBe("fresh");
    expect(all[1]?.prs).toHaveLength(1);
    expect(listPrs).toHaveBeenCalledWith("github", [{ slug: "owner/repo" }]);
  });

  it("does not stack rail refreshes for the same repo", async () => {
    let answer: (value: PullRequest[]) => void = () => {};
    listPrs.mockReturnValue(
      new Promise<PullRequest[]>((resolve) => {
        answer = resolve;
      }),
    );
    const first = refreshPrsForBranch("owner/repo", "b");
    await refreshPrsForBranch("owner/repo", "b");
    expect(listPrs).toHaveBeenCalledTimes(1);

    answer([]);
    await first;
    await refreshPrsForBranch("owner/repo", "b");
    expect(listPrs).toHaveBeenCalledTimes(2);
  });

  it("asks git for a workspace's remotes once when two callers race", async () => {
    await Promise.all([loadWorkspaceRepos(["/w"]), loadWorkspaceRepos(["/w"])]);

    expect(listWorkspaceRepos).toHaveBeenCalledTimes(1);
  });
});
