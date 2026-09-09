import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => true),
  readTextFile: vi.fn(async () => "{}"),
  writeTextFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  readDir: vi.fn(async () => []),
  remove: vi.fn(async () => {}),
  BaseDirectory: { Home: 0 },
}));

vi.mock("../ipc", () => ({
  listClaudePlans: vi.fn(async () => []),
  listDir: vi.fn(async () => []),
  listWorkspaceDocs: vi.fn(async () => []),
  readTextFileAt: vi.fn(async () => ""),
  writeTextFileAt: vi.fn(async () => {}),
  startSessionTail: vi.fn(),
  stopSessionTail: vi.fn(),
}));

import type { DocEntry, PlanEntry } from "../../types/files";
import {
  absolutePath,
  ancestorPaths,
  breadcrumbs,
  buildDocTree,
  editorTarget,
  fileKey,
  hasUnsavedUnder,
  matchLineEndings,
  parentDir,
  parseFileKey,
  planWorkspace,
  resolveWikilink,
  slugifyPath,
  touchedBy,
  type TreeNode,
} from "../files";
import { listWorkspaceDocs } from "../ipc";
import type { SessionTile } from "../overview";
import {
  activeFile,
  docEntries,
  expanded,
  fileWs,
  loadDocs,
  openFile,
  openFiles,
  toggleExpanded,
} from "../stores/files";
import type { Workspace } from "../stores/workspace";

function doc(rel_path: string, is_dir = false): DocEntry {
  return {
    rel_path,
    name: rel_path.split("/").pop() ?? rel_path,
    is_dir,
    size: is_dir ? 0 : 10,
    modified: null,
  };
}

/** The backend's order: directories first, then case-insensitively by name. */
function listed(entries: DocEntry[]): DocEntry[] {
  return [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

function plan(name: string): PlanEntry {
  return { name, path: `/home/me/.claude/plans/${name}.md`, modified: null };
}

function workspace(path: string): Workspace {
  return { path, name: path.split(/[\\/]/).pop() ?? path, sessions: [] };
}

function child(node: TreeNode, name: string): TreeNode {
  const found = node.children.find((c) => c.name === name);
  if (!found) throw new Error(`no child ${name} under ${node.relPath || "<root>"}`);
  return found;
}

describe("file keys", () => {
  it("round trips a workspace file", () => {
    const key = fileKey("E:/GitHub/Atlas", "docs/guide.md");
    expect(parseFileKey(key)).toEqual({ source: "E:/GitHub/Atlas", path: "docs/guide.md" });
  });

  it("round trips when either half contains spaces", () => {
    const key = fileKey("C:/Program Files/My Repo", "notes/my note.md");
    expect(parseFileKey(key)).toEqual({
      source: "C:/Program Files/My Repo",
      path: "notes/my note.md",
    });
  });

  it("round trips the synthetic sources", () => {
    expect(parseFileKey(fileKey("plans", "/home/me/.claude/plans/a.md"))).toEqual({
      source: "plans",
      path: "/home/me/.claude/plans/a.md",
    });
    expect(parseFileKey(fileKey("disk", "/tmp/scratch.md"))).toEqual({
      source: "disk",
      path: "/tmp/scratch.md",
    });
  });

  it("reads a key with no separator as a bare disk path", () => {
    expect(parseFileKey("/tmp/loose.md")).toEqual({ source: "disk", path: "/tmp/loose.md" });
  });

  it("resolves a path against its source", () => {
    expect(absolutePath("/home/me/atlas", "docs/guide.md")).toBe("/home/me/atlas/docs/guide.md");
    expect(absolutePath("/home/me/atlas/", "guide.md")).toBe("/home/me/atlas/guide.md");
    expect(absolutePath("plans", "/home/me/.claude/plans/a.md")).toBe(
      "/home/me/.claude/plans/a.md",
    );
    expect(absolutePath("disk", "/tmp/scratch.md")).toBe("/tmp/scratch.md");
  });
});

describe("matchLineEndings", () => {
  it("restores the CRLF a Windows-authored file was read with", () => {
    expect(matchLineEndings("a\nb\nc", "a\r\nb\r\nc")).toBe("a\r\nb\r\nc");
  });

  it("leaves an LF file alone", () => {
    expect(matchLineEndings("a\nb", "a\nb")).toBe("a\nb");
  });

  it("writes LF for a file with no endings to copy", () => {
    expect(matchLineEndings("a\nb", undefined)).toBe("a\nb");
    expect(matchLineEndings("a\nb", "")).toBe("a\nb");
    expect(matchLineEndings("a\nb", "one line")).toBe("a\nb");
  });

  it("goes by the first ending, so a stray CRLF does not convert the file", () => {
    expect(matchLineEndings("a\nb\nc", "a\nb\r\nc")).toBe("a\nb\nc");
  });

  it("does not double up endings that are already CRLF", () => {
    expect(matchLineEndings("a\r\nb", "a\r\nb")).toBe("a\r\nb");
  });
});

describe("buildDocTree", () => {
  it("folds the flat listing into nested nodes", () => {
    const roots = buildDocTree(
      listed([doc("docs", true), doc("docs/guide.md"), doc("README.md")]),
    );

    expect(roots.map((n) => n.name)).toEqual(["docs", "README.md"]);
    expect(roots[0].isDir).toBe(true);
    expect(child(roots[0], "guide.md")).toMatchObject({
      relPath: "docs/guide.md",
      isDir: false,
    });
  });

  it("keeps a directory that holds no documents", () => {
    const roots = buildDocTree(listed([doc("src", true), doc("README.md")]));
    expect(child({ children: roots } as TreeNode, "src")).toMatchObject({
      isDir: true,
      children: [],
    });
  });

  it("sorts each level, not just the flat list", () => {
    // The backend sorts globally by name, so `aa` (inside `mm`) arrives before
    // `bb` — folding that order without re-sorting would put `mm` first.
    const roots = buildDocTree(
      listed([doc("mm", true), doc("bb", true), doc("mm/aa", true), doc("mm/aa/deep.md")]),
    );
    expect(roots.map((n) => n.name)).toEqual(["bb", "mm"]);
  });

  it("creates a missing parent for a nested file", () => {
    const roots = buildDocTree([doc("a/b/c.md")]);
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({ name: "a", isDir: true });
    expect(child(child(roots[0], "b"), "c.md")).toMatchObject({ relPath: "a/b/c.md" });
  });

  it("is empty for an empty listing", () => {
    expect(buildDocTree([])).toEqual([]);
  });
});

describe("hasUnsavedUnder", () => {
  const roots = buildDocTree(
    listed([doc("docs", true), doc("docs/guide.md"), doc("docs/notes.md"), doc("README.md")]),
  );
  const docsFolder = roots[0];

  it("reports a folder unsaved only when a descendant is", () => {
    expect(hasUnsavedUnder(docsFolder, new Set())).toBe(false);
    expect(hasUnsavedUnder(docsFolder, new Set(["README.md"]))).toBe(false);
    expect(hasUnsavedUnder(docsFolder, new Set(["docs/notes.md"]))).toBe(true);
  });

  it("reports a file by its own path", () => {
    const guide = child(docsFolder, "guide.md");
    expect(hasUnsavedUnder(guide, new Set(["docs/guide.md"]))).toBe(true);
    expect(hasUnsavedUnder(guide, new Set(["docs/notes.md"]))).toBe(false);
  });
});

describe("ancestorPaths", () => {
  it("lists the folders on the way to a nested file, outermost first", () => {
    expect(ancestorPaths("docs/guide/intro.md")).toEqual(["docs", "docs/guide"]);
  });

  it("has none for a file at the root of the tree", () => {
    expect(ancestorPaths("README.md")).toEqual([]);
    expect(ancestorPaths("")).toEqual([]);
  });

  it("skips empty segments", () => {
    expect(ancestorPaths("docs//guide/intro.md")).toEqual(["docs", "docs/guide"]);
  });
});

describe("tree expansion", () => {
  const ws = "/home/me/atlas";
  const other = "/home/me/other";

  beforeEach(() => {
    fileWs.set("");
    expanded.set(new Set());
    openFiles.set([]);
    activeFile.set("");
    docEntries.set([]);
    vi.mocked(listWorkspaceDocs).mockResolvedValue([]);
  });

  it("lists a workspace with every folder shut", async () => {
    vi.mocked(listWorkspaceDocs).mockResolvedValue(
      listed([doc("docs", true), doc("docs/guide.md"), doc("src", true), doc("README.md")]),
    );
    fileWs.set(ws);
    await loadDocs(ws);

    // Both folders are listed, and neither is in `expanded` — which is what the
    // tree's `shut` reads, so both rows render closed.
    expect(
      buildDocTree(get(docEntries))
        .filter((n) => n.isDir)
        .map((n) => n.name),
    ).toEqual(["docs", "src"]);
    expect([...get(expanded)]).toEqual([]);
  });

  it("opens and shuts one folder", () => {
    fileWs.set(ws);
    toggleExpanded(fileKey(ws, "docs"));
    expect(get(expanded).has(fileKey(ws, "docs"))).toBe(true);
    toggleExpanded(fileKey(ws, "docs"));
    expect(get(expanded).has(fileKey(ws, "docs"))).toBe(false);
  });

  it("leaves open folders open when the watcher re-lists the tree", async () => {
    fileWs.set(ws);
    toggleExpanded(fileKey(ws, "docs"));
    toggleExpanded(fileKey(ws, "src"));

    // What `onDocsChanged` runs on every external edit, with a folder that was
    // not there the first time round.
    vi.mocked(listWorkspaceDocs).mockResolvedValue(
      listed([doc("docs", true), doc("docs/guide.md"), doc("src", true), doc("notes", true)]),
    );
    await loadDocs(ws);

    expect(get(expanded)).toEqual(new Set([fileKey(ws, "docs"), fileKey(ws, "src")]));
    // A directory discovered by the re-list starts shut rather than popping open.
    expect(get(expanded).has(fileKey(ws, "notes"))).toBe(false);
  });

  it("collapses everything again when the workspace changes", () => {
    fileWs.set(ws);
    toggleExpanded(fileKey(ws, "docs"));
    fileWs.set(other);
    expect([...get(expanded)]).toEqual([]);
  });

  it("reveals a nested file opened from the palette or a cross-link", () => {
    fileWs.set(ws);
    openFile(ws, "docs/guide/intro.md");
    expect(get(activeFile)).toBe(fileKey(ws, "docs/guide/intro.md"));
    expect(get(expanded)).toEqual(new Set([fileKey(ws, "docs"), fileKey(ws, "docs/guide")]));
  });

  it("reveals a file opened by a cross-link that switched workspace first", () => {
    fileWs.set(ws);
    toggleExpanded(fileKey(ws, "docs"));
    // The session rail sets `fileWs` and then opens — the reset must not undo
    // the reveal that follows it.
    fileWs.set(other);
    openFile(other, "notes/today.md");
    expect(get(expanded)).toEqual(new Set([fileKey(other, "notes")]));
  });

  it("has no folders to reveal for the flat plan and disk lists", () => {
    fileWs.set(ws);
    openFile("plans", "/home/me/.claude/plans/a.md");
    openFile("disk", "/tmp/scratch.md");
    expect([...get(expanded)]).toEqual([]);
  });

  it("still marks a shut folder that holds an unsaved file", () => {
    fileWs.set(ws);
    const roots = buildDocTree(listed([doc("docs", true), doc("docs/guide.md")]));
    expect(get(expanded).has(fileKey(ws, "docs"))).toBe(false);
    expect(hasUnsavedUnder(roots[0], new Set(["docs/guide.md"]))).toBe(true);
  });
});

describe("planWorkspace", () => {
  it("slugifies a path the way Claude Code names plan files", () => {
    expect(slugifyPath("C:\\Users\\jakeh\\Documents\\GitHub\\Atlas")).toBe(
      "c-users-jakeh-documents-github-atlas",
    );
    expect(slugifyPath("/home/me/my project/")).toBe("home-me-my-project");
  });

  it("matches a plan to its workspace by the slug prefix", () => {
    const ws = workspace("/home/me/atlas");
    expect(planWorkspace(plan("home-me-atlas-curried-thacker"), [ws])).toBe("/home/me/atlas");
  });

  it("gives a nested workspace its own plans", () => {
    const outer = workspace("/home/me/atlas");
    const inner = workspace("/home/me/atlas/packages/ui");
    expect(planWorkspace(plan("home-me-atlas-packages-ui-brisk-owl"), [outer, inner])).toBe(
      "/home/me/atlas/packages/ui",
    );
    // Order must not decide it — the longest matching slug does.
    expect(planWorkspace(plan("home-me-atlas-packages-ui-brisk-owl"), [inner, outer])).toBe(
      "/home/me/atlas/packages/ui",
    );
    expect(planWorkspace(plan("home-me-atlas-brisk-owl"), [outer, inner])).toBe(
      "/home/me/atlas",
    );
  });

  it("matches a posix plan whose stem kept the leading separator", () => {
    // A cwd of `/home/me/atlas` slugifies without the leading dash, but the
    // plan file can carry one — the way `~/.claude/projects` names macOS
    // projects `-Users-me-atlas`.
    const ws = workspace("/home/me/atlas");
    expect(planWorkspace(plan("-home-me-atlas-curried-thacker"), [ws])).toBe("/home/me/atlas");
  });

  it("returns null when no workspace owns the plan", () => {
    expect(planWorkspace(plan("var-tmp-elsewhere-lively-fox"), [workspace("/home/me/atlas")])).toBe(
      null,
    );
    expect(planWorkspace(plan("anything"), [])).toBe(null);
  });
});

describe("resolveWikilink", () => {
  const entries = [doc("docs/guide.md"), doc("notes/Daily Log.md"), doc("readme.txt")];

  it("matches a full rel path, with or without the extension", () => {
    expect(resolveWikilink("docs/guide.md", entries)).toBe("docs/guide.md");
    expect(resolveWikilink("docs/guide", entries)).toBe("docs/guide.md");
  });

  it("matches a bare file name, ignoring case", () => {
    expect(resolveWikilink("daily log", entries)).toBe("notes/Daily Log.md");
    expect(resolveWikilink("readme.txt", entries)).toBe("readme.txt");
  });

  it("returns null for a target nothing matches", () => {
    expect(resolveWikilink("missing", entries)).toBe(null);
    expect(resolveWikilink("  ", entries)).toBe(null);
  });
});

describe("breadcrumbs", () => {
  const last = <T,>(items: T[]): T => items[items.length - 1];

  it("walks a windows path from its drive root", () => {
    expect(breadcrumbs("C:\\Users\\me\\Notes")).toEqual([
      { label: "C:", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "me", path: "C:\\Users\\me" },
      { label: "Notes", path: "C:\\Users\\me\\Notes" },
    ]);
  });

  it("walks a posix path from /", () => {
    expect(breadcrumbs("/home/me/notes")).toEqual([
      { label: "/", path: "/" },
      { label: "home", path: "/home" },
      { label: "me", path: "/home/me" },
      { label: "notes", path: "/home/me/notes" },
    ]);
  });

  it("ignores a trailing separator", () => {
    expect(last(breadcrumbs("/home/me/"))).toEqual({ label: "me", path: "/home/me" });
    expect(last(breadcrumbs("C:\\Users\\"))).toEqual({ label: "Users", path: "C:\\Users" });
  });

  it("reports a root as one crumb", () => {
    expect(breadcrumbs("/")).toEqual([{ label: "/", path: "/" }]);
    expect(breadcrumbs("C:\\")).toEqual([{ label: "C:", path: "C:\\" }]);
  });
});

describe("parentDir", () => {
  it("climbs one level", () => {
    expect(parentDir("/home/me/notes")).toBe("/home/me");
    expect(parentDir("C:\\Users\\me")).toBe("C:\\Users");
    expect(parentDir("C:\\Users")).toBe("C:\\");
  });

  it("has nowhere to climb from a root", () => {
    expect(parentDir("/")).toBe(null);
    expect(parentDir("C:\\")).toBe(null);
  });
});

describe("touchedBy", () => {
  function tile(overrides: Partial<SessionTile>): SessionTile {
    return {
      sessionUuid: "uuid",
      atlasSessionId: "atlas-1",
      terminalTabId: "tab-1",
      workspacePath: "/home/me/atlas",
      workspaceName: "Atlas",
      workspaceColour: "#2fa37a",
      label: "Refactor",
      branch: "main",
      state: "running",
      live: {} as SessionTile["live"],
      diff: null,
      ...overrides,
    };
  }

  const touched = new Map([
    ["tab-1", [{ path: "docs/guide.md", added: 12, removed: 3, repo: "" }]],
  ]);

  it("finds the session whose diff carries the file", () => {
    expect(touchedBy("/home/me/atlas/docs/guide.md", [tile({})], touched)).toEqual([
      { sessionId: "atlas-1", label: "Refactor", state: "running", added: 12, removed: 3 },
    ]);
  });

  it("matches across separators and drive-letter case", () => {
    const windows = new Map([
      ["tab-1", [{ path: "docs/guide.md", added: 1, removed: 0, repo: "" }]],
    ]);
    const rows = touchedBy(
      "c:\\Users\\me\\atlas\\docs\\guide.md",
      [tile({ workspacePath: "C:\\Users\\me\\atlas" })],
      windows,
    );
    expect(rows).toHaveLength(1);
  });

  it("does not match a same-named file in another workspace", () => {
    const rows = touchedBy(
      "/home/me/other/docs/guide.md",
      [tile({}), tile({ workspacePath: "/home/me/other", terminalTabId: "tab-2" })],
      touched,
    );
    expect(rows).toEqual([]);
  });

  it("puts the repo between the workspace and the path when there is one", () => {
    // A workspace holding several repos diffs each one separately, so the path
    // is relative to the repo rather than to the workspace.
    const multi = new Map([
      ["tab-1", [{ path: "docs/guide.md", added: 4, removed: 1, repo: "api" }]],
    ]);
    expect(touchedBy("/home/me/atlas/api/docs/guide.md", [tile({})], multi)).toEqual([
      { sessionId: "atlas-1", label: "Refactor", state: "running", added: 4, removed: 1 },
    ]);
    // ...and the workspace-relative path is no longer a match on its own.
    expect(touchedBy("/home/me/atlas/docs/guide.md", [tile({})], multi)).toEqual([]);
  });

  it("skips a session with no live tab and an empty path", () => {
    expect(touchedBy("/home/me/atlas/docs/guide.md", [tile({ terminalTabId: null })], touched))
      .toEqual([]);
    expect(touchedBy("", [tile({})], touched)).toEqual([]);
  });
});

describe("editorTarget", () => {
  /* A language server is rooted at a project, and the uri it is told about has
     to be relative to that root or it reports diagnostics against a file it
     cannot find. A workspace file already has both halves; a plans or ad-hoc
     disk file has only an absolute path, so its own directory stands in as the
     root. */
  it("uses the workspace as the root for a file inside one", () => {
    expect(editorTarget("/repo/web", "src/app.ts")).toEqual({
      root: "/repo/web",
      relative: "src/app.ts",
    });
  });

  it("roots a loose disk file at its own directory", () => {
    expect(editorTarget("disk", "/tmp/notes/todo.ts")).toEqual({
      root: "/tmp/notes",
      relative: "todo.ts",
    });
  });

  it("roots a plans file at the plans directory", () => {
    expect(editorTarget("plans", "/home/j/.claude/plans/a.md")).toEqual({
      root: "/home/j/.claude/plans",
      relative: "a.md",
    });
  });

  it("drops a trailing separator on the workspace so the uri has no double slash", () => {
    expect(editorTarget("/repo/web/", "src/app.ts").root).toBe("/repo/web");
  });
});
