// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { get } from "svelte/store";
import NotificationsPanel, {
  relativeTime,
  unreadNotificationCount,
} from "../components/ui/NotificationsPanel.svelte";
import { notificationLog } from "../stores/toast";

const entry = (id: string, title: string, read = false) => ({
  id,
  title,
  body: `${title} body`,
  type: "error" as const,
  time: Date.now(),
  read,
});

beforeEach(() => {
  notificationLog.set([entry("a", "First"), entry("b", "Second"), entry("c", "Third", true)]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("NotificationsPanel", () => {
  it("lists newest first and counts unread", () => {
    render(NotificationsPanel);
    const items = screen.getAllByRole("listitem");
    expect(items[0]?.textContent).toContain("Third");
    expect(items[2]?.textContent).toContain("First");
    expect(get(unreadNotificationCount)).toBe(2);
  });

  it("marks everything read after a second of being open", () => {
    vi.useFakeTimers();
    render(NotificationsPanel);
    vi.advanceTimersByTime(1000);
    expect(get(unreadNotificationCount)).toBe(0);
  });

  it("clears on request", async () => {
    const user = userEvent.setup();
    render(NotificationsPanel);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(get(notificationLog)).toEqual([]);
    expect(screen.getByText("No notifications")).toBeTruthy();
  });

  it("copies a row", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(NotificationsPanel);
    await user.click(screen.getAllByRole("button", { name: "Copy" })[2]!);
    expect(writeText).toHaveBeenCalledWith("First\nFirst body");
  });

  it("formats relative time", () => {
    expect(relativeTime(0, 30_000)).toBe("just now");
    expect(relativeTime(0, 5 * 60_000)).toBe("5m ago");
    expect(relativeTime(0, 3 * 3_600_000)).toBe("3h ago");
  });
});
