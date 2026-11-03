// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRawSnippet, flushSync } from "svelte";
import { cleanup, render, screen } from "@testing-library/svelte";
import Spinner from "../components/ui/Spinner.svelte";
import spinnerSrc from "../components/ui/Spinner.svelte?raw";
import Progress from "../components/ui/Progress.svelte";
import Skeleton from "../components/ui/Skeleton.svelte";
import EmptyState from "../components/ui/EmptyState.svelte";
import { delayedFlag } from "../ui/delay";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Spinner", () => {
  it("is a status with its label", async () => {
    render(Spinner, { label: "Loading" });
    expect((await screen.findByRole("status")).textContent).toContain("Loading");
  });
  it("shows nothing until the delay has passed", () => {
    vi.useFakeTimers();
    render(Spinner, { label: "Loading", delay: 1000 });
    expect(screen.queryByRole("status")).toBeNull();
    vi.advanceTimersByTime(999);
    flushSync();
    expect(screen.queryByRole("status")).toBeNull();
    vi.advanceTimersByTime(1);
    flushSync();
    expect(screen.getByRole("status")).toBeTruthy();
  });
  it("stops spinning under reduced motion", () => {
    expect(spinnerSrc).toMatch(
      /prefers-reduced-motion: reduce\)\s*{\s*\.spin\s*{\s*animation: none/,
    );
  });
});

describe("Progress", () => {
  it("exposes value, min and max", () => {
    render(Progress, { label: "Reading", value: 12, max: 40, count: "12 / 40" });
    const bar = screen.getByRole("progressbar", { name: "Reading" });
    expect(bar.getAttribute("aria-valuenow")).toBe("12");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("40");
  });
  it("indeterminate has no aria-valuenow", () => {
    render(Progress, { label: "Scanning" });
    expect(screen.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(false);
  });
});

describe("Skeleton", () => {
  it("renders a block", async () => {
    const { container } = render(Skeleton, { width: "50%" });
    await vi.waitFor(() => expect(container.querySelector(".block")).toBeTruthy());
  });
  it("marks its region aria-busy", async () => {
    const children = createRawSnippet(() => ({ render: () => "<span>x</span>" }));
    const { container } = render(Skeleton, { children });
    await vi.waitFor(() => expect(container.querySelector("[aria-busy='true']")).toBeTruthy());
  });
});

describe("EmptyState", () => {
  it("shows title and description; compact shows only the title", () => {
    const props = { icon: "folder", title: "None", description: "Add one" } as const;
    const { unmount } = render(EmptyState, props);
    expect(screen.getByText("Add one")).toBeTruthy();
    unmount();
    render(EmptyState, { ...props, compact: true });
    expect(screen.queryByText("Add one")).toBeNull();
    expect(screen.getByText("None")).toBeTruthy();
  });
});

describe("delayedFlag", () => {
  it("fires true only after the delay and false immediately", () => {
    vi.useFakeTimers();
    const seen: boolean[] = [];
    const f = delayedFlag((v) => seen.push(v));
    f.set(true);
    vi.advanceTimersByTime(999);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([true]);
    f.set(false);
    expect(seen).toEqual([true, false]);
  });
  it("a load that ends under the delay never shows", () => {
    vi.useFakeTimers();
    const seen: boolean[] = [];
    const f = delayedFlag((v) => seen.push(v));
    f.set(true);
    vi.advanceTimersByTime(500);
    f.set(false);
    vi.advanceTimersByTime(2000);
    expect(seen).toEqual([false]);
  });
});
