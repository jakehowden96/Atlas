// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import DiffViewer from "../components/panel/DiffViewer.svelte";
import type { DiffData } from "../../types/panel";

afterEach(cleanup);

const SMALL_TWO_FILE_DIFF = `diff --git a/src/a.ts b/src/a.ts
index abc1234..def5678 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
-old line in a
+new line in a
 context line in a
diff --git a/src/b.ts b/src/b.ts
index 1111111..2222222 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,2 +1,2 @@
-old line in b
+new line in b
 context line in b
`;

/** Build a diff for one file with `linesAdded` added lines — used to exceed the 500-line auto-collapse threshold. */
function buildLargeDiff(path: string, linesAdded: number): string {
  const adds = Array.from({ length: linesAdded }, (_, i) => `+line ${i}`).join("\n");
  return (
    `diff --git a/${path} b/${path}\n` +
    `index abc1234..def5678 100644\n` +
    `--- a/${path}\n` +
    `+++ b/${path}\n` +
    `@@ -1,0 +1,${linesAdded} @@\n` +
    `${adds}\n`
  );
}

function makeData(raw: string): DiffData {
  return {
    raw,
    files_changed: 0,
    lines_added: 0,
    lines_removed: 0,
  };
}

describe("DiffViewer collapse behavior", () => {
  it("clicking a file header toggles its hunks in the DOM", async () => {
    const { container } = render(DiffViewer, {
      props: { data: makeData(SMALL_TWO_FILE_DIFF), cwd: "/repo" },
    });

    // Both files start expanded — diff lines for both files are present.
    const linesBefore = container.querySelectorAll(".diff-line");
    expect(linesBefore.length).toBeGreaterThan(0);

    // Find the first file's header button.
    const headerButtons = container.querySelectorAll<HTMLButtonElement>(
      ".file-header[role='button'], button.file-header"
    );
    expect(headerButtons.length).toBe(2);

    const firstFileSection = headerButtons[0].closest(".file-section")!;
    const linesInFirstBefore = firstFileSection.querySelectorAll(".diff-line").length;
    expect(linesInFirstBefore).toBeGreaterThan(0);

    // Click the first file's header — its hunks should disappear.
    await fireEvent.click(headerButtons[0]);
    const linesInFirstAfter = firstFileSection.querySelectorAll(".diff-line").length;
    expect(linesInFirstAfter).toBe(0);

    // Second file remains expanded.
    const secondFileSection = headerButtons[1].closest(".file-section")!;
    expect(secondFileSection.querySelectorAll(".diff-line").length).toBeGreaterThan(0);

    // Click again — hunks reappear.
    await fireEvent.click(headerButtons[0]);
    expect(firstFileSection.querySelectorAll(".diff-line").length).toBe(linesInFirstBefore);
  });

  it("chevron rotates between expand_more (expanded) and chevron_right (collapsed)", async () => {
    const { container } = render(DiffViewer, {
      props: { data: makeData(SMALL_TWO_FILE_DIFF), cwd: "/repo" },
    });

    const headerButton = container.querySelector<HTMLButtonElement>(
      ".file-header[role='button'], button.file-header"
    )!;
    const chevron = headerButton.querySelector(".chevron")!;
    expect(chevron.textContent?.trim()).toBe("expand_more");

    await fireEvent.click(headerButton);
    expect(chevron.textContent?.trim()).toBe("chevron_right");
  });

  it("auto-collapses files >500 lines and shows a 'Show N lines' expand button", async () => {
    const raw = buildLargeDiff("big.ts", 600);
    const { container } = render(DiffViewer, {
      props: { data: makeData(raw), cwd: "/repo" },
    });

    // Hunks should NOT be visible — auto-collapsed.
    expect(container.querySelectorAll(".diff-line").length).toBe(0);

    // The "Show N lines" expand button should be present.
    const expandBtn = container.querySelector<HTMLButtonElement>(".expand-btn");
    expect(expandBtn).not.toBeNull();
    expect(expandBtn!.textContent).toMatch(/Show\s+\d+\s+lines/);

    // Clicking "Show N lines" reveals the hunks.
    await fireEvent.click(expandBtn!);
    expect(container.querySelectorAll(".diff-line").length).toBeGreaterThan(0);
  });

  it("Viewed and Collapsed states are independent", async () => {
    const { container } = render(DiffViewer, {
      props: { data: makeData(SMALL_TWO_FILE_DIFF), cwd: "/repo" },
    });

    const headerButton = container.querySelector<HTMLButtonElement>(
      ".file-header[role='button'], button.file-header"
    )!;
    const fileSection = headerButton.closest(".file-section") as HTMLElement;
    const viewedToggle = fileSection.querySelector<HTMLInputElement>(
      "input[type='checkbox'].viewed-toggle"
    )!;
    expect(viewedToggle).not.toBeNull();
    expect(viewedToggle.checked).toBe(false);
    expect(fileSection.classList.contains("collapsed")).toBe(false);

    // Toggle Viewed — should NOT collapse the file.
    await fireEvent.click(viewedToggle);
    expect(viewedToggle.checked).toBe(true);
    expect(fileSection.classList.contains("collapsed")).toBe(false);
    expect(fileSection.querySelectorAll(".diff-line").length).toBeGreaterThan(0);

    // Now collapse the file — Viewed stays checked.
    await fireEvent.click(headerButton);
    expect(fileSection.classList.contains("collapsed")).toBe(true);
    expect(viewedToggle.checked).toBe(true);
  });
});
