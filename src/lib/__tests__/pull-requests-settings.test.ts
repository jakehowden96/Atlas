// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({ stateLoad: vi.fn(), stateSave: vi.fn() }));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import PullRequests from "../components/settings/sections/PullRequests.svelte";
import { watchedRepos } from "../stores/settings";

afterEach(cleanup);

describe("watched repositories", () => {
  it("accepts owner/name and rejects anything else", async () => {
    watchedRepos.set([]);
    render(PullRequests);
    const input = screen.getByLabelText("Watched repositories", {
      selector: "input",
    }) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "nope" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(get(watchedRepos)).toEqual([]);
    await fireEvent.input(input, { target: { value: "acme/web" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(get(watchedRepos)).toEqual(["acme/web"]));
  });
});
