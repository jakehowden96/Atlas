import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_KEYMAP,
  findConflicts,
  formatBinding,
  matchBinding,
  matchesAnyBinding,
  mergeKeymap,
  parseBindingFromEvent,
  type Keymap,
} from "../keymap";

function makeKeyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    key: "",
    code: "",
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

describe("matchBinding", () => {
  it("accepts ⌘ and Ctrl alike", () => {
    const b = DEFAULT_KEYMAP.newSession;
    expect(matchBinding(makeKeyEvent({ metaKey: true, key: "n" }), b)).toBe(true);
    expect(matchBinding(makeKeyEvent({ ctrlKey: true, key: "n" }), b)).toBe(true);
    expect(matchBinding(makeKeyEvent({ key: "n" }), b)).toBe(false);
  });

  it("is case-insensitive on the key", () => {
    expect(matchBinding(makeKeyEvent({ metaKey: true, key: "N" }), DEFAULT_KEYMAP.jump)).toBe(
      false,
    );
    expect(matchBinding(makeKeyEvent({ metaKey: true, key: "K" }), DEFAULT_KEYMAP.jump)).toBe(true);
  });

  it("rejects Alt — AltGr reports as Ctrl+Alt on a non-US layout", () => {
    const digit = makeKeyEvent({ ctrlKey: true, altKey: true, key: "@", code: "Digit2" });
    expect(matchBinding(digit, DEFAULT_KEYMAP.tab2)).toBe(false);
    const backslash = makeKeyEvent({ ctrlKey: true, altKey: true, key: "\\" });
    expect(matchBinding(backslash, DEFAULT_KEYMAP.toggleRail)).toBe(false);
  });

  it("matches digits on e.code, not e.key", () => {
    // A French layout types "é" on the 2 key with the modifier held.
    const e = makeKeyEvent({ metaKey: true, key: "é", code: "Digit2" });
    expect(matchBinding(e, DEFAULT_KEYMAP.tab2)).toBe(true);
    expect(matchBinding(makeKeyEvent({ metaKey: true, key: "2" }), DEFAULT_KEYMAP.tab2)).toBe(
      false,
    );
  });

  it("honours Shift when the binding pins it, and ignores it when it does not", () => {
    const shifted = makeKeyEvent({ metaKey: true, shiftKey: true, key: "1", code: "Digit1" });
    expect(matchBinding(shifted, DEFAULT_KEYMAP.tab1)).toBe(false);
    // ⌘\ is bound without a Shift preference — Ctrl+Shift+\ still toggles it.
    const rail = makeKeyEvent({ ctrlKey: true, shiftKey: true, key: "\\" });
    expect(matchBinding(rail, DEFAULT_KEYMAP.toggleRail)).toBe(true);
  });

  it("mod+Escape is a binding but bare Escape is not", () => {
    const b = DEFAULT_KEYMAP.backToSessions;
    expect(matchBinding(makeKeyEvent({ metaKey: true, key: "Escape" }), b)).toBe(true);
    expect(matchBinding(makeKeyEvent({ key: "Escape" }), b)).toBe(false);
    expect(matchesAnyBinding(makeKeyEvent({ key: "Escape" }), DEFAULT_KEYMAP)).toBe(false);
  });
});

describe("findConflicts", () => {
  it("finds nothing in the defaults", () => {
    expect(findConflicts(DEFAULT_KEYMAP)).toEqual([]);
  });

  it("returns both actions that share a binding", () => {
    const clashing: Keymap = { ...DEFAULT_KEYMAP, jump: { mod: true, shift: false, key: "n" } };
    expect(findConflicts(clashing).sort()).toEqual(["jump", "newSession"]);
  });
});

describe("formatBinding", () => {
  it("renders ⌘ on mac and Ctrl+ elsewhere", () => {
    expect(formatBinding(DEFAULT_KEYMAP.newSession, true)).toBe("⌘N");
    expect(formatBinding(DEFAULT_KEYMAP.newSession, false)).toBe("Ctrl+N");
    expect(formatBinding(DEFAULT_KEYMAP.settings, true)).toBe("⌘,");
    expect(formatBinding(DEFAULT_KEYMAP.toggleRail, false)).toBe("Ctrl+\\");
  });

  it("names digits by their code and spells Escape out", () => {
    expect(formatBinding(DEFAULT_KEYMAP.tab3, true)).toBe("⌘3");
    expect(formatBinding(DEFAULT_KEYMAP.backToSessions, true)).toBe("⌘Esc");
    expect(formatBinding(DEFAULT_KEYMAP.backToSessions, false)).toBe("Ctrl+Esc");
  });

  it("renders Shift", () => {
    expect(formatBinding({ mod: true, shift: true, key: "p" }, true)).toBe("⌘⇧P");
    expect(formatBinding({ mod: true, shift: true, key: "p" }, false)).toBe("Ctrl+Shift+P");
  });
});

describe("parseBindingFromEvent", () => {
  it("turns a keypress into a binding", () => {
    expect(parseBindingFromEvent(makeKeyEvent({ metaKey: true, key: "p" }))).toEqual({
      mod: true,
      shift: false,
      key: "p",
    });
    expect(
      parseBindingFromEvent(
        makeKeyEvent({ ctrlKey: true, shiftKey: true, key: "@", code: "Digit2" }),
      ),
    ).toEqual({ mod: true, shift: true, key: "Digit2" });
  });

  it("rejects bare modifiers, AltGr and chords without ⌘/Ctrl", () => {
    expect(parseBindingFromEvent(makeKeyEvent({ metaKey: true, key: "Meta" }))).toBeNull();
    expect(
      parseBindingFromEvent(makeKeyEvent({ ctrlKey: true, altKey: true, key: "@" })),
    ).toBeNull();
    expect(parseBindingFromEvent(makeKeyEvent({ key: "p" }))).toBeNull();
  });
});

describe("mergeKeymap", () => {
  it("lays a partial keymap over the defaults", () => {
    const merged = mergeKeymap({ jump: { mod: true, shift: false, key: "p" } });
    expect(merged.jump).toEqual({ mod: true, shift: false, key: "p" });
    expect(merged.newSession).toEqual(DEFAULT_KEYMAP.newSession);
  });

  it("drops malformed entries rather than throwing", () => {
    const merged = mergeKeymap({
      jump: { mod: "yes", key: "p" },
      settings: { mod: true, key: "" },
      tab1: null,
      nonsense: { mod: true, key: "z" },
    });
    expect(merged).toEqual(DEFAULT_KEYMAP);
    expect(mergeKeymap(undefined)).toEqual(DEFAULT_KEYMAP);
    expect(mergeKeymap("not an object")).toEqual(DEFAULT_KEYMAP);
  });
});
