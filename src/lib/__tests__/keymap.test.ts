import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_KEYMAP,
  findConflicts,
  formatBinding,
  formatChord,
  isReachable,
  matchBinding,
  matchesAction,
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
    const b = DEFAULT_KEYMAP.newSession[0];
    expect(matchBinding(makeKeyEvent({ metaKey: true, key: "n" }), b)).toBe(true);
    expect(matchBinding(makeKeyEvent({ ctrlKey: true, key: "n" }), b)).toBe(true);
    expect(matchBinding(makeKeyEvent({ key: "n" }), b)).toBe(false);
  });

  it("is case-insensitive on the key", () => {
    expect(matchBinding(makeKeyEvent({ metaKey: true, key: "N" }), DEFAULT_KEYMAP.jump[0])).toBe(
      false,
    );
    expect(matchBinding(makeKeyEvent({ metaKey: true, key: "K" }), DEFAULT_KEYMAP.jump[0])).toBe(true);
  });

  it("rejects Alt — AltGr reports as Ctrl+Alt on a non-US layout", () => {
    const digit = makeKeyEvent({ ctrlKey: true, altKey: true, key: "@", code: "Digit2" });
    expect(matchBinding(digit, DEFAULT_KEYMAP.tab2[0])).toBe(false);
    const backslash = makeKeyEvent({ ctrlKey: true, altKey: true, key: "\\" });
    expect(matchBinding(backslash, DEFAULT_KEYMAP.toggleRail[0])).toBe(false);
  });

  it("matches digits on e.code, not e.key", () => {
    // A French layout types "é" on the 2 key with the modifier held.
    const e = makeKeyEvent({ metaKey: true, key: "é", code: "Digit2" });
    expect(matchBinding(e, DEFAULT_KEYMAP.tab2[0])).toBe(true);
    expect(matchBinding(makeKeyEvent({ metaKey: true, key: "2" }), DEFAULT_KEYMAP.tab2[0])).toBe(
      false,
    );
  });

  it("honours Shift when the binding pins it, and ignores it when it does not", () => {
    const shifted = makeKeyEvent({ metaKey: true, shiftKey: true, key: "1", code: "Digit1" });
    expect(matchBinding(shifted, DEFAULT_KEYMAP.tab1[0])).toBe(false);
    // ⌘\ is bound without a Shift preference — Ctrl+Shift+\ still toggles it.
    const rail = makeKeyEvent({ ctrlKey: true, shiftKey: true, key: "\\" });
    expect(matchBinding(rail, DEFAULT_KEYMAP.toggleRail[0])).toBe(true);
  });

  it("the shortcut sheet is a chord, not a bare `?`", () => {
    const b = DEFAULT_KEYMAP.shortcuts[0];
    expect(matchBinding(makeKeyEvent({ metaKey: true, key: "/" }), b)).toBe(true);
    expect(matchBinding(makeKeyEvent({ ctrlKey: true, key: "/" }), b)).toBe(true);
    // A modifierless binding would swallow the character in every text box.
    expect(matchBinding(makeKeyEvent({ key: "?" }), b)).toBe(false);
    expect(matchesAnyBinding(makeKeyEvent({ key: "/" }), DEFAULT_KEYMAP)).toBe(false);
  });

  it("mod+Escape is a binding but bare Escape is not", () => {
    const b = DEFAULT_KEYMAP.backToSessions[0];
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
    const clashing: Keymap = {
      ...DEFAULT_KEYMAP,
      jump: [{ mod: true, shift: false, key: "n" }],
    };
    expect(findConflicts(clashing).sort()).toEqual(["jump", "newSession"]);
  });
});

describe("formatBinding", () => {
  it("renders ⌘ on mac and Ctrl+ elsewhere", () => {
    expect(formatBinding(DEFAULT_KEYMAP.newSession[0], true)).toBe("⌘N");
    expect(formatBinding(DEFAULT_KEYMAP.newSession[0], false)).toBe("Ctrl+N");
    expect(formatBinding(DEFAULT_KEYMAP.settings[0], true)).toBe("⌘,");
    expect(formatBinding(DEFAULT_KEYMAP.toggleRail[0], false)).toBe("Ctrl+\\");
  });

  it("names digits by their code and spells Escape out", () => {
    expect(formatBinding(DEFAULT_KEYMAP.tab3[0], true)).toBe("⌘3");
    expect(formatBinding(DEFAULT_KEYMAP.backToSessions[0], true)).toBe("⌘Esc");
    expect(formatBinding(DEFAULT_KEYMAP.backToSessions[0], false)).toBe("Ctrl+Esc");
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
    const merged = mergeKeymap({ jump: [{ mod: true, shift: false, key: "p" }] });
    expect(merged.jump).toEqual([{ mod: true, shift: false, key: "p" }]);
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

// ── Alternates ───────────────────────────────────────────────────────────────

describe("a second chord per action", () => {
  const mac = (key: string, over: Partial<KeyboardEvent> = {}) =>
    makeKeyEvent({ metaKey: true, key, ...over });

  it("fires backToSessions from either chord", () => {
    const chords = DEFAULT_KEYMAP.backToSessions;
    expect(matchesAction(mac("Escape"), chords)).toBe(true);
    expect(matchesAction(mac("."), chords)).toBe(true);
  });

  it("still leaves bare Escape to the Claude TUI", () => {
    // The whole reason backToSessions needs a chord at all.
    expect(matchesAction(makeKeyEvent({ key: "Escape" }), DEFAULT_KEYMAP.backToSessions)).toBe(
      false,
    );
    expect(matchesAction(makeKeyEvent({ key: "." }), DEFAULT_KEYMAP.backToSessions)).toBe(false);
    expect(matchesAnyBinding(makeKeyEvent({ key: "Escape" }), DEFAULT_KEYMAP)).toBe(false);
  });

  it("detects a conflict reached through an alternate", () => {
    // `jump`'s second chord collides with backToSessions' second chord. Only
    // one of them could ever fire, so both rows have to be marked.
    const clashing: Keymap = {
      ...DEFAULT_KEYMAP,
      jump: [...DEFAULT_KEYMAP.jump, { mod: true, shift: false, key: "." }],
    };
    expect(findConflicts(clashing).sort()).toEqual(["backToSessions", "jump"]);
  });

  it("keeps the defaults conflict-free with the alternate in place", () => {
    expect(findConflicts(DEFAULT_KEYMAP)).toEqual([]);
  });
});

describe("isReachable", () => {
  it("marks ⌘Escape unreachable on macOS only", () => {
    const cmdEscape = DEFAULT_KEYMAP.backToSessions[0];
    expect(isReachable(cmdEscape, true)).toBe(false);
    expect(isReachable(cmdEscape, false)).toBe(true);
  });

  it("leaves every other chord alone", () => {
    expect(isReachable(DEFAULT_KEYMAP.backToSessions[1], true)).toBe(true);
    expect(isReachable(DEFAULT_KEYMAP.newSession[0], true)).toBe(true);
    expect(isReachable(DEFAULT_KEYMAP.tab1[0], true)).toBe(true);
  });
});

describe("formatChord", () => {
  it("hides the chord macOS swallows and names the one that works", () => {
    expect(formatChord(DEFAULT_KEYMAP.backToSessions, true)).toBe("⌘.");
  });

  it("names both where both arrive", () => {
    expect(formatChord(DEFAULT_KEYMAP.backToSessions, false)).toBe("Ctrl+Esc or Ctrl+.");
  });

  it("falls back to naming everything rather than nothing", () => {
    // A chord the platform eats, with no alternate: a wrong hint still beats a
    // blank one.
    expect(formatChord([DEFAULT_KEYMAP.backToSessions[0]], true)).toBe("⌘Esc");
  });

  it("is just the binding for a single-chord action", () => {
    expect(formatChord(DEFAULT_KEYMAP.newSession, true)).toBe("⌘N");
  });
});

describe("mergeKeymap and older settings files", () => {
  it("reads a single binding written before alternates existed", () => {
    const merged = mergeKeymap({ jump: { mod: true, shift: false, key: "p" } });
    expect(merged.jump).toEqual([{ mod: true, shift: false, key: "p" }]);
  });

  it("keeps the default when every entry in a list is malformed", () => {
    const merged = mergeKeymap({ jump: [{ mod: "yes" }, null] });
    expect(merged.jump).toEqual(DEFAULT_KEYMAP.jump);
  });

  it("keeps the good half of a partly malformed list", () => {
    const merged = mergeKeymap({ jump: [{ mod: true, key: "p" }, 7] });
    expect(merged.jump).toEqual([{ mod: true, shift: undefined, key: "p" }]);
  });
});
