import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import AgentManager from "../components/layout/AgentManager.svelte";

interface Session {
  id: string;
  label: string;
  status: "complete" | "running" | "error" | "idle" | "starting";
  age: string;
  terminalTabId: string | null;
}

interface Workspace {
  path: string;
  name: string;
  color?: string;
  sessions: Session[];
}

function fixture(): Workspace[] {
  return [
    {
      path: "/r/atlas",
      name: "atlas",
      color: "#ff0000",
      sessions: [
        {
          id: "s1",
          label: "Fix Bug",
          status: "running",
          age: "1m",
          terminalTabId: "tab-1",
        },
        {
          id: "s2",
          label: "Add Feature",
          status: "idle",
          age: "2m",
          terminalTabId: "tab-2",
        },
      ],
    },
    {
      path: "/r/cmux",
      name: "cmux",
      color: "#00ff00",
      sessions: [
        {
          id: "s3",
          label: "Refactor",
          status: "running",
          age: "5m",
          terminalTabId: "tab-3",
        },
      ],
    },
  ];
}

describe("AgentManager flat list", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders one row per session across all workspaces", () => {
    const { getAllByTestId } = render(AgentManager, {
      props: { workspaces: fixture() },
    });
    const rows = getAllByTestId("session-row");
    expect(rows).toHaveLength(3);
  });

  it("session label is rendered as {workspace}/{title}", () => {
    const { getAllByTestId } = render(AgentManager, {
      props: { workspaces: fixture() },
    });
    const labels = getAllByTestId("session-label").map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toEqual(
      expect.arrayContaining([
        "atlas/Fix Bug",
        "atlas/Add Feature",
        "cmux/Refactor",
      ]),
    );
  });

  it("each row's stripe color matches its workspace color", () => {
    const { getAllByTestId } = render(AgentManager, {
      props: { workspaces: fixture() },
    });
    const rows = getAllByTestId("session-row");
    const stripes = rows.map(
      (r) => r.querySelector("[data-testid='session-stripe']") as HTMLElement,
    );
    // Order corresponds to render order: atlas's two then cmux's one
    expect(stripes[0].style.background).toContain("rgb(255, 0, 0)");
    expect(stripes[1].style.background).toContain("rgb(255, 0, 0)");
    expect(stripes[2].style.background).toContain("rgb(0, 255, 0)");
  });

  it("filter input narrows the list by substring of workspace/title", async () => {
    const { getByRole, getAllByTestId, queryAllByTestId } = render(
      AgentManager,
      { props: { workspaces: fixture() } },
    );
    expect(getAllByTestId("session-row")).toHaveLength(3);
    const input = getByRole("textbox");
    await fireEvent.input(input, { target: { value: "atlas/Fix" } });
    const labels = queryAllByTestId("session-label").map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toEqual(["atlas/Fix Bug"]);
  });

  it("filter is case-insensitive on workspace+title", async () => {
    const { getByRole, queryAllByTestId } = render(AgentManager, {
      props: { workspaces: fixture() },
    });
    const input = getByRole("textbox");
    await fireEvent.input(input, { target: { value: "REFACTOR" } });
    const labels = queryAllByTestId("session-label").map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toEqual(["cmux/Refactor"]);
  });

  it("renders an (empty) diff-badge slot on every row", () => {
    const { getAllByTestId } = render(AgentManager, {
      props: { workspaces: fixture() },
    });
    const slots = getAllByTestId("diff-badge-slot");
    expect(slots).toHaveLength(3);
  });

  it("clicking a session row invokes onSelectSession with workspace+id", async () => {
    const onSelectSession = vi.fn();
    const { getAllByTestId } = render(AgentManager, {
      props: { workspaces: fixture(), onSelectSession },
    });
    const rows = getAllByTestId("session-row");
    await fireEvent.click(rows[2]); // cmux/Refactor
    expect(onSelectSession).toHaveBeenCalledWith({
      workspacePath: "/r/cmux",
      sessionId: "s3",
    });
  });

  it("clicking the close button invokes onDeleteSession", async () => {
    const onDeleteSession = vi.fn();
    const { getAllByTestId } = render(AgentManager, {
      props: { workspaces: fixture(), onDeleteSession },
    });
    const buttons = getAllByTestId("session-close-btn");
    await fireEvent.click(buttons[0]); // atlas/Fix Bug
    expect(onDeleteSession).toHaveBeenCalledWith({
      workspacePath: "/r/atlas",
      sessionId: "s1",
    });
  });

  it("clicking the + button opens the quick switcher", async () => {
    const { getByTestId, queryByRole } = render(AgentManager, {
      props: { workspaces: fixture() },
    });
    expect(queryByRole("dialog")).toBeNull();
    await fireEvent.click(getByTestId("open-quick-switcher"));
    expect(queryByRole("dialog")).not.toBeNull();
  });

  it("falls back to '(untitled)' when session.label is empty", () => {
    const data: Workspace[] = [
      {
        path: "/r/atlas",
        name: "atlas",
        color: "#000",
        sessions: [
          {
            id: "x",
            label: "",
            status: "idle",
            age: "",
            terminalTabId: null,
          },
        ],
      },
    ];
    const { getByTestId } = render(AgentManager, { props: { workspaces: data } });
    expect(getByTestId("session-label").textContent).toContain("(untitled)");
  });
});
