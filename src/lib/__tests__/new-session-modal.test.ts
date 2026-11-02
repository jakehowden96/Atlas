// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";

vi.mock("../ipc", () => ({
  listResumableSessions: vi.fn(),
  validateDirectory: vi.fn(),
  ghViewer: vi.fn(),
  listRepoPrs: vi.fn(),
  listWorkspaceRepos: vi.fn(),
  getGitStatus: vi.fn(),
  openUrl: vi.fn(),
}));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn(async () => "/home/u") }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../session-actions", () => ({
  addWorkspaceFolder: vi.fn(),
  removeWorkspaceWithUndo: vi.fn(),
  spawnHarnessSession: vi.fn(async () => ({ id: "s1" })),
  workOnPr: vi.fn(async () => true),
}));

import { listResumableSessions } from "../ipc";
import { spawnHarnessSession, workOnPr } from "../session-actions";
import NewSessionModal from "../components/session/NewSessionModal.svelte";
import { prRepos, reposByWorkspace } from "../stores/prs";
import { newSessionOpen } from "../stores/view";
import { workspaces } from "../stores/workspace";
import type { Pr } from "../../types/generated/Pr";

// happy-dom does no layout; Modal's tabbables() skips zero-size elements.
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1 });
Element.prototype.scrollIntoView = () => {};

const ws = { path: "/w/atlas", name: "atlas", sessions: [] };

function pr(number: number): Pr {
  return {
    number,
    title: `Change ${number}`,
    url: "",
    author: { login: "octocat" },
    createdAt: "",
    updatedAt: "",
    isDraft: false,
    isCrossRepository: false,
    headRefName: "feat/x",
    ciState: "passed",
    reviewState: "none",
    reviewRequestLogins: [],
    commentsCount: 0,
  };
}

const resumeRows = [
  { sessionId: "aaaa1111", title: "First", lastTimestamp: null, userMessages: 3, gitBranch: "main" },
  { sessionId: "bbbb2222", title: "Second", lastTimestamp: null, userMessages: 5, gitBranch: null },
];

beforeEach(() => {
  workspaces.set([ws]);
  reposByWorkspace.set({ "/w/atlas": [{ path: "/w/atlas", slug: "o/atlas" }] });
  prRepos.set([]);
  vi.mocked(listResumableSessions).mockResolvedValue(resumeRows as never);
  newSessionOpen.set(true);
});
afterEach(() => {
  cleanup();
  newSessionOpen.set(false);
  vi.clearAllMocks();
});

describe("NewSessionModal", () => {
  it("is a named dialog with a mode tablist, harness radiogroup and workspace listbox", async () => {
    render(NewSessionModal);
    expect(await screen.findByRole("dialog", { name: "New session" })).toBeTruthy();
    expect(screen.getAllByRole("tab").map((t) => t.textContent?.trim())).toEqual([
      "New",
      expect.stringMatching(/^Resume/),
      expect.stringMatching(/^From PR/),
    ]);
    expect(screen.getByRole("radiogroup", { name: "Harness" })).toBeTruthy();
    expect(screen.getByRole("listbox", { name: /Workspaces/ })).toBeTruthy();
    // The remove action is a sibling control, never a button inside a button.
    expect(document.querySelectorAll("button button").length).toBe(0);
  });

  it("lists prior sessions as radios and arrow keys move between them", async () => {
    const user = userEvent.setup();
    render(NewSessionModal);
    await user.click(await screen.findByRole("tab", { name: /Resume/ }));
    const group = await screen.findByRole("radiogroup", { name: "Prior sessions" });
    const radios = group.querySelectorAll<HTMLElement>('[role="radio"]');
    expect(radios.length).toBe(2);
    radios[0]!.focus();
    await user.keyboard("{ArrowDown}");
    expect(radios[1]!.getAttribute("aria-checked")).toBe("true");
  });

  it("keeps the arrow keys on the harness while the filter box has focus", async () => {
    const user = userEvent.setup();
    render(NewSessionModal);
    const claude = await screen.findByRole("radio", { name: "Claude Code" });
    expect(claude.getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("textbox", { name: "Workspace or path" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Terminal" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("starts a session from the keyboard alone", async () => {
    const user = userEvent.setup();
    render(NewSessionModal);
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("textbox", { name: "Workspace or path" }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(spawnHarnessSession).toHaveBeenCalled());
    expect(vi.mocked(spawnHarnessSession).mock.calls[0]![0]).toBe("/w/atlas");
  });

  it("From PR: empty state when the workspace has no open PRs", async () => {
    const user = userEvent.setup();
    render(NewSessionModal);
    await user.click(await screen.findByRole("tab", { name: /From PR/ }));
    expect(await screen.findByText("No open pull requests for this workspace")).toBeTruthy();
  });

  it("From PR: lists the workspace repo's PRs and Enter works on the chosen one", async () => {
    prRepos.set([
      { repo: "o/atlas", prs: [pr(7), pr(8)], error: null },
      { repo: "o/other", prs: [pr(99)], error: null },
    ]);
    const user = userEvent.setup();
    render(NewSessionModal);
    await user.click(await screen.findByRole("tab", { name: /From PR/ }));
    expect(await screen.findByText("Change 7")).toBeTruthy();
    expect(screen.queryByText("Change 99")).toBeNull();
    await user.click(screen.getByRole("textbox", { name: "Workspace or path" }));
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(workOnPr).toHaveBeenCalled());
    expect(vi.mocked(workOnPr).mock.calls[0]![0]).toBe("o/atlas");
    expect(vi.mocked(workOnPr).mock.calls[0]![1].number).toBe(8);
  });

  it("From PR: shows a link to settings when GitHub is not set up", async () => {
    prRepos.set([
      { repo: "o/atlas", prs: [], error: { kind: "not_authenticated" } as never },
    ]);
    render(NewSessionModal);
    await fireEvent.click(await screen.findByRole("tab", { name: /From PR/ }));
    expect(await screen.findByRole("button", { name: "Open settings" })).toBeTruthy();
  });

  it("Resume: shows an alert with a retry when the lookup fails", async () => {
    vi.mocked(listResumableSessions).mockRejectedValueOnce(new Error("boom"));
    render(NewSessionModal);
    await fireEvent.click(await screen.findByRole("tab", { name: /Resume/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("radiogroup", { name: "Prior sessions" })).toBeTruthy();
  });
});
