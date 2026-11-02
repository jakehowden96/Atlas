// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({}) }));
vi.mock("../ipc", () => ({ classifyPaths: vi.fn() }));

import DropTarget from "../components/ui/DropTarget.svelte";

afterEach(cleanup);

describe("DropTarget", () => {
  it("announces the headline and hint while over", () => {
    render(DropTarget, { state: { kind: "over", folders: 1, files: 0 } });
    expect(screen.getByRole("status").textContent).toContain("Drop to add as a workspace");
    expect(screen.getByText("1 folder")).toBeTruthy();
  });

  it("renders nothing visible while idle", () => {
    const { container } = render(DropTarget, { state: { kind: "idle" } });
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector(".drop")?.getAttribute("aria-hidden")).toBe("true");
  });
});
