import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import WorkspaceQuickSwitcher from "../components/layout/WorkspaceQuickSwitcher.svelte";

interface WS {
  path: string;
  name: string;
  color: string;
  lastUsedAt: number;
}

function fixture(): WS[] {
  return [
    { path: "/r/alpha", name: "alpha", color: "#aaa", lastUsedAt: 100 },
    { path: "/r/beta", name: "beta", color: "#bbb", lastUsedAt: 300 },
    { path: "/r/gamma", name: "gamma", color: "#ccc", lastUsedAt: 200 },
  ];
}

describe("WorkspaceQuickSwitcher", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders one row per workspace plus the Add folder row", () => {
    const { getAllByRole } = render(WorkspaceQuickSwitcher, {
      props: { workspaces: fixture() },
    });
    const rows = getAllByRole("option");
    expect(rows).toHaveLength(4);
  });

  it("sorts workspaces with most recently used first", () => {
    const { getAllByTestId } = render(WorkspaceQuickSwitcher, {
      props: { workspaces: fixture() },
    });
    const names = getAllByTestId("ws-row-name").map((el) =>
      el.textContent?.trim(),
    );
    expect(names).toEqual(["beta", "gamma", "alpha"]);
  });

  it("Add folder… row is always last, even after filtering", async () => {
    const { getByRole, getAllByRole } = render(WorkspaceQuickSwitcher, {
      props: { workspaces: fixture() },
    });
    const input = getByRole("textbox");
    await fireEvent.input(input, { target: { value: "alpha" } });
    const rows = getAllByRole("option");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const last = rows[rows.length - 1];
    expect(last.textContent).toMatch(/Add folder/i);
  });

  it("filter narrows the list by substring of name", async () => {
    const { getByRole, getAllByTestId, queryAllByTestId } = render(
      WorkspaceQuickSwitcher,
      { props: { workspaces: fixture() } },
    );
    expect(getAllByTestId("ws-row-name")).toHaveLength(3);
    const input = getByRole("textbox");
    await fireEvent.input(input, { target: { value: "be" } });
    const names = queryAllByTestId("ws-row-name").map((el) =>
      el.textContent?.trim(),
    );
    expect(names).toEqual(["beta"]);
  });

  it("Enter on highlighted row dispatches newSession with the right path", async () => {
    const onNewSession = vi.fn();
    const { getByRole } = render(WorkspaceQuickSwitcher, {
      props: { workspaces: fixture(), onNewSession },
    });
    const input = getByRole("textbox");
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(onNewSession).toHaveBeenCalledWith({ workspacePath: "/r/beta" });
  });

  it("↓ moves highlight to next row, Enter selects that one", async () => {
    const onNewSession = vi.fn();
    const { getByRole } = render(WorkspaceQuickSwitcher, {
      props: { workspaces: fixture(), onNewSession },
    });
    const input = getByRole("textbox");
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onNewSession).toHaveBeenCalledWith({ workspacePath: "/r/gamma" });
  });

  it("↑ moves highlight to previous row", async () => {
    const onNewSession = vi.fn();
    const { getByRole } = render(WorkspaceQuickSwitcher, {
      props: { workspaces: fixture(), onNewSession },
    });
    const input = getByRole("textbox");
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "ArrowUp" });
    await fireEvent.keyDown(input, { key: "Enter" });
    // beta → gamma → alpha → gamma
    expect(onNewSession).toHaveBeenCalledWith({ workspacePath: "/r/gamma" });
  });

  it("Esc dispatches close", async () => {
    const onClose = vi.fn();
    const { getByRole } = render(WorkspaceQuickSwitcher, {
      props: { workspaces: fixture(), onClose },
    });
    const input = getByRole("textbox");
    await fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking backdrop dispatches close", async () => {
    const onClose = vi.fn();
    const { getByTestId } = render(WorkspaceQuickSwitcher, {
      props: { workspaces: fixture(), onClose },
    });
    await fireEvent.click(getByTestId("backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter on Add folder row dispatches addFolder", async () => {
    const onAddFolder = vi.fn();
    const { getByRole } = render(WorkspaceQuickSwitcher, {
      props: { workspaces: fixture(), onAddFolder },
    });
    const input = getByRole("textbox");
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onAddFolder).toHaveBeenCalledTimes(1);
  });
});
