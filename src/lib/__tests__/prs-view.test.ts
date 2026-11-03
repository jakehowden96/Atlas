// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";

vi.mock("../ipc", () => ({
  openUrl: vi.fn(async () => {}),
  connectorListPullRequests: vi.fn(),
  listWorkspaceRepos: vi.fn(),
}));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../session-actions", () => ({ workOnPr: vi.fn(async () => false) }));

import { workOnPr } from "../session-actions";
import { checkoutCommand, groupChecks, retryLabel, searchPrs, sortPrs, prStatus } from "../pr-view";
import PrsView from "../components/prs/PrsView.svelte";
import { connectors } from "../stores/connectors";
import { prRepos, reposByWorkspace, type Pr } from "../stores/prs";
import { watchedRepos } from "../stores/settings";
import type { ConnectorState } from "../../types/generated/ConnectorState";

function pr(over: Partial<Pr> = {}): Pr {
  return {
    number: 1,
    title: "A change",
    url: "https://x/pull/1",
    author: { login: "octocat" },
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    isDraft: false,
    isCrossRepository: false,
    headRefName: "feat/thing",
    ciState: "passed",
    reviewState: "approved",
    reviewRequestLogins: [],
    commentsCount: 0,
    checks: [
      { name: "build", status: "pass", detailsUrl: "https://x/build" },
      { name: "lint", status: "fail", detailsUrl: null },
      { name: "e2e", status: "pending", detailsUrl: null },
    ],
    review: { kind: "approved" },
    checkoutRef: { repo: "o/r", number: 1 },
    ...over,
  } as Pr;
}

const linked = (kind: ConnectorState["status"] = { kind: "linked", account: "octocat" }) =>
  [
    {
      info: { id: "gh", name: "Forge", kind: "pullRequests", flow: "browser", configured: true },
      status: kind,
    },
  ] as ConnectorState[];

describe("pr-view helpers", () => {
  const a = pr({ number: 1, title: "Fix login", updatedAt: "2026-09-01T00:00:00Z", ciState: "passed" });
  const b = pr({
    number: 22,
    title: "Add cache",
    author: { login: "hubot" },
    headRefName: "cache",
    updatedAt: "2026-09-05T00:00:00Z",
    createdAt: "2026-07-01T00:00:00Z",
    ciState: "failed",
    reviewState: "review_required",
  });

  it("sorts by each key", () => {
    expect(sortPrs([a, b], "updated").map((p) => p.number)).toEqual([22, 1]);
    expect(sortPrs([a, b], "created").map((p) => p.number)).toEqual([1, 22]);
    expect(sortPrs([a, b], "ci").map((p) => p.number)).toEqual([22, 1]);
    expect(sortPrs([a, b], "review").map((p) => p.number)).toEqual([22, 1]);
  });

  it("searches title, author, branch and number", () => {
    expect(searchPrs([a, b], "login")).toEqual([a]);
    expect(searchPrs([a, b], "HUBOT")).toEqual([b]);
    expect(searchPrs([a, b], "cache")).toEqual([b]);
    expect(searchPrs([a, b], "#22")).toEqual([b]);
    expect(searchPrs([a, b], "  ")).toEqual([a, b]);
    expect(searchPrs([a, b], "zzz")).toEqual([]);
  });

  it("derives status, groups checks, labels retry and the checkout command", () => {
    expect(prStatus(b)).toEqual({ state: "failing", word: "Failing" });
    expect(prStatus(pr({ isDraft: true })).word).toBe("Draft");
    const g = groupChecks(a.checks);
    expect([g.failing.length, g.running.length, g.passed.length]).toEqual([1, 1, 1]);
    expect(retryLabel(100 + 180, 100_000)).toBe("Try again in 3m");
    expect(retryLabel(1, 100_000)).toBe("Try again now");
    expect(checkoutCommand(a)).toBe("git checkout feat/thing");
    expect(checkoutCommand(pr({ isCrossRepository: true, number: 7 }))).toContain("pull/7/head");
  });
});

describe("PrsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectors.set(linked());
    watchedRepos.set(["o/r"]);
    reposByWorkspace.set({});
    prRepos.set([{ repo: "o/r", prs: [pr()], error: null }]);
  });
  afterEach(cleanup);

  it("asks to connect when no connector is linked", () => {
    connectors.set(linked({ kind: "notLinked" }));
    render(PrsView);
    expect(screen.getByText("Connect a pull request service")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open connectors" })).toBeTruthy();
  });

  it("offers to add repos when none are watched", () => {
    watchedRepos.set([]);
    reposByWorkspace.set({ "/w": [{ path: "/w", slug: "me/app" }] });
    render(PrsView);
    expect(screen.getByText("No repositories watched yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add me/app" })).toBeTruthy();
  });

  it("shows loading, empty and no-match states", async () => {
    prRepos.set(null);
    render(PrsView);
    expect(screen.getByLabelText("Loading pull requests")).toBeTruthy();
    prRepos.set([{ repo: "o/r", prs: [], error: null }]);
    expect(await screen.findByText("No open pull requests")).toBeTruthy();
    prRepos.set([{ repo: "o/r", prs: [pr()], error: null }]);
    await fireEvent.input(screen.getByLabelText("Search pull requests"), {
      target: { value: "zzz" },
    });
    expect(await screen.findByText("Nothing matches")).toBeTruthy();
  });

  it("keeps a failed repo's card with a Banner and no provider name hard-coded", () => {
    prRepos.set([
      { repo: "o/r", prs: [], error: { kind: "connectorError", message: "Boom" } },
    ]);
    const { container } = render(PrsView);
    expect(screen.getByText("Boom")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/\bgh\b|GitHub/);
  });

  it("expands a row to its checks, failing first, passed folded", async () => {
    render(PrsView);
    const toggle = screen.getByRole("button", { name: "Show checks for #1" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("lint")).toBeTruthy();
    expect(screen.getByText("e2e")).toBeTruthy();
    expect(screen.queryByText("build")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Show 1 passed" }));
    expect(screen.getByRole("button", { name: "Open build" })).toBeTruthy();
  });

  it("labels the open button with the connector name", () => {
    render(PrsView);
    expect(screen.getByRole("button", { name: "Open on Forge" })).toBeTruthy();
  });

  it("shows the checkout failure with the command and retries", async () => {
    render(PrsView);
    await fireEvent.click(screen.getByRole("button", { name: /Work on it/ }));
    expect(await screen.findByText("git checkout feat/thing")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(workOnPr).toHaveBeenCalledTimes(2));
  });
});
