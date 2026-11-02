// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({
  listClaudePlans: vi.fn(async () => []),
  listDir: vi.fn(async () => ({ entries: [], truncated: false })),
  listWorkspaceDocs: vi.fn(async () => ({ entries: [], truncated: false })),
  startDocsWatch: vi.fn(async () => {}),
  stopDocsWatch: vi.fn(async () => {}),
  onDocsChanged: vi.fn(async () => () => {}),
}));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../stores/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../stores/settings")>()),
  setFileSources: vi.fn(),
  setOpenFiles: vi.fn(),
}));

import FileTree from "../components/files/FileTree.svelte";
import { fileKey } from "../files";
import { docEntries, docs, expanded, fileWs, plans } from "../stores/files";
import { workspaces } from "../stores/workspace";
import { listWorkspaceDocs } from "../ipc";

const entry = (rel_path: string, is_dir = false) => ({
  rel_path,
  name: rel_path.split("/").pop() ?? rel_path,
  is_dir,
});
const FIXTURE = [
  entry("a", true),
  entry("a/b", true),
  entry("a/b/deep.md"),
  entry("a/top.json"),
  entry("readme.md"),
];

function seed(fixture = FIXTURE) {
  vi.mocked(listWorkspaceDocs).mockResolvedValue({
    entries: fixture,
    truncated: false,
  } as never);
  workspaces.set([{ path: "/ws", name: "ws" }] as never);
  fileWs.set("/ws");
  docEntries.set(fixture as never);
  plans.set([]);
  docs.set(new Map());
  expanded.set(new Set());
}

const mount = (fixture = FIXTURE) => {
  seed(fixture);
  render(FileTree);
};

afterEach(cleanup);

const docsTree = () => screen.getByRole("tree", { name: "ws docs" });
const items = () => [...docsTree().querySelectorAll<HTMLElement>("[role=treeitem]")];
const names = () => items().map((i) => i.querySelector(".label")?.textContent?.trim());

describe("FileTree", () => {
  it("gives rows a level and expanded state", async () => {
    mount();
    await waitFor(() => expect(items().length).toBe(2));
    const [a, readme] = items();
    expect(a?.getAttribute("aria-level")).toBe("1");
    expect(a?.getAttribute("aria-expanded")).toBe("false");
    expect(readme?.getAttribute("aria-expanded")).toBeNull();
  });

  it("walks a nested fixture with the arrow keys", async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(items().length).toBe(2));
    items()[0]?.focus();
    await user.keyboard("{ArrowRight}");
    expect(get(expanded).has(fileKey("/ws", "a"))).toBe(true);
    await waitFor(() => expect(names()).toEqual(["a", "b", "top.json", "readme.md"]));
    await user.keyboard("{ArrowRight}{ArrowDown}");
    expect(document.activeElement?.getAttribute("aria-level")).toBe("2");
    await user.keyboard("{ArrowRight}{End}");
    expect(document.activeElement?.textContent).toContain("readme.md");
    await user.keyboard("{Home}");
    expect(document.activeElement?.textContent).toContain("a");
  });

  it("opens every folder while filtering", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(
      screen.getAllByRole("searchbox", { name: "Search files" })[0] as HTMLElement,
      "deep",
    );
    await waitFor(() => expect(names()).toEqual(["a", "b", "deep.md"]));
  });

  it("marks a collapsed folder holding unsaved edits", async () => {
    mount();
    docs.set(new Map([[fileKey("/ws", "a/b/deep.md"), "x"]]));
    await waitFor(() =>
      expect(items()[0]?.querySelector("[aria-label='Unsaved changes']")).not.toBeNull(),
    );
  });

  it("shows compact empty states", async () => {
    mount([]);
    await waitFor(() => {
      expect(screen.getByText("No plans yet")).toBeTruthy();
      expect(screen.getByText("No docs in this workspace")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Add a folder" })).toBeTruthy();
    });
  });
});
