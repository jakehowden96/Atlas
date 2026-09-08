import { describe, expect, it } from "vitest";

import type { DocEntry, PlanEntry } from "../../types/files";
import {
  absolutePath,
  buildDocTree,
  fileKey,
  hasUnsavedUnder,
  parseFileKey,
  planWorkspace,
  slugifyPath,
  type TreeNode,
} from "../files";
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

  it("returns null when no workspace owns the plan", () => {
    expect(planWorkspace(plan("var-tmp-elsewhere-lively-fox"), [workspace("/home/me/atlas")])).toBe(
      null,
    );
    expect(planWorkspace(plan("anything"), [])).toBe(null);
  });
});
