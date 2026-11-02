// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tooltip } from "../ui/tooltip";

function mount(opts: Parameters<typeof tooltip>[1]) {
  const btn = document.createElement("button");
  document.body.append(btn);
  const action = tooltip(btn, opts);
  return { btn, action };
}

describe("tooltip action", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("opens after 400ms on hover", () => {
    const { btn } = mount({ text: "Save" });
    btn.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(399);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    vi.advanceTimersByTime(1);
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Save");
  });

  it("honours delay 0", () => {
    const { btn } = mount({ text: "Save", delay: 0 });
    btn.dispatchEvent(new MouseEvent("mouseenter"));
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  });

  it("opens immediately on focus and wires aria-describedby", () => {
    const { btn } = mount({ text: "Save", shortcut: "Cmd S" });
    btn.focus();
    const tip = document.querySelector('[role="tooltip"]');
    expect(tip?.textContent).toContain("Cmd S");
    expect(btn.getAttribute("aria-describedby")).toBe(tip?.id);
  });

  it("closes on Esc, blur and leave", () => {
    const { btn } = mount({ text: "Save" });
    btn.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(btn.hasAttribute("aria-describedby")).toBe(false);
    btn.blur();
    btn.focus();
    btn.blur();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    btn.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(400);
    btn.dispatchEvent(new MouseEvent("mouseleave"));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
});
