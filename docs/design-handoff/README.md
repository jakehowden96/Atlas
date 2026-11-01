# Handoff: Atlas polish pass — component system, connectors, states

## Overview
This pass makes Atlas read as one finished product. It has three parts:
- **A component system.** One button family, one field, one list/tree row, one focus ring, one status mark, and shared feedback, overlay and empty/loading patterns.
- **New connector UI.** OAuth-linked, provider-neutral services: tickets and pull requests.
- **Designed states for every screen**, plus the app-level states that had none.

Target: Tauri v2 + Svelte 5, Windows and macOS, a minimum window of 800×500 and a default of 1400×900, light and dark.

## About the design files
The `.dc.html` files are **design references built in HTML**, not production code. Recreate them in the Atlas Svelte codebase:
- as scoped components under `src/lib/components/ui/`,
- using CSS custom properties from `src/app.css` plus the additions in `tokens/additions.css`.

Every frame is drawn in both themes from the same markup, so a token-only implementation themes itself.

| File | What it holds |
| --- | --- |
| `Atlas Components.dc.html` | Component sheet: foundations, focus, status mark, icons and mark, button, field, choice controls, kbd/badge/pill/chip, banner/toast, tooltip/menu/popover, tabs/segmented/list/tree, empty/skeleton/spinner, modal/drawer/confirm |
| `Connectors.dc.html` | Settings → Connectors, OAuth dialogs, Pull requests screen states, token-expiry notice |
| `Rail States.dc.html` | Ticket header editing states, tile loading/stale/connector states, 48px rail |
| `Screens – Shell and Sessions.dc.html` | Top bar at 1400/1100/800, Sessions grid and tile, Session view, app-level states |
| `Screens – Work Views.dc.html` | Jump, New Session, Changes drawer, Files, Stats, Settings copy, shortcut sheet |
| `Session Rail v6.dc.html` | The rail this builds on (its own handoff: `design_handoff_session_rail/`) |
| `docs/audit.md` | Ranked audit with tags and where each fix lives |
| `docs/product-gaps.md` | Missing behaviour, separate from styling |
| `docs/chart-guidance.md` | Rules for the Stats charts |

## Fidelity
**High fidelity.**
- Colours, type and radii are existing tokens and must not be renamed.
- New tokens live only in `tokens/additions.css` (copy it into `app.css`).
- No hex values in components. The two hard-coded ones today (`--warn-ink`, the switch knob's `#fff`) are removed.

---

## Token additions (`tokens/additions.css`)
- **Spacing** `--sp-0…9`: 2, 4, 6, 8, 12, 16, 20, 24, 32, 48.
- **Control heights**
  - `--h-2xs` 18 (switch, count badge), `--h-xs` 20 (pill), `--h-sm` 24, `--h-md` 28 (**default**), `--h-lg` 32 (list row, tab), `--h-xl` 40 (palette input), `--h-bar` 44 (view/modal header).
  - The top bar keeps 46.
- **Radius** `--r-pill` 999px. It replaces the literals 9, 13 and 20 on pills, chips and the switch. The literals 2, 5 and 14 map to `--r-xs`, `--r-sm` and `--r-card-lg`.
- **Elevation**
  - `--ring` is level 0 (cards).
  - `--elev-1` covers menu, popover and tooltip.
  - `--elev-2` (= `--shadow`) covers modal, drawer and toast.
  - Cards never take a shadow, including on hover.
- **Layers** `--z-sticky` 10, `--z-drawer` 20, `--z-overlay` 30, `--z-popover` 40, `--z-toast` 50, `--z-tooltip` 60, `--z-titlebar` 70.
- **Motion**
  - Durations: `--dur-instant` 80, `--dur-fast` 120, `--dur-base` 180, `--dur-slow` 280.
  - Easings: `--ease-out`, `--ease-in-out`, `--ease-exit`.
  - `--pulse` is the shared live animation. `atlasSpin` replaces `tileSpin` and `agentPulse`.
- **Focus** `--focus` (= `--text`), `--focus-width` 2px, `--focus-offset` 2px.

### Global recipes
- **Focus ring.** Selector: `:focus-visible { outline: var(--focus-width) solid var(--focus); outline-offset: var(--focus-offset); }`.
  - Inside clipped lists and rows, the offset is −2px; on text inputs, 1px.
  - The ring is ink, never a state colour, and it is never removed without a replacement.
  - The Sessions grid keeps its scripted `focusVisible` flag but draws this ring.
- **Hover / active / disabled.**
  - On `--surface`: hover `--surface2`, active `--surface3`.
  - Outlined controls: `--border2` at rest; hover adds the `--surface2` fill.
  - Ink fill: hover is `color-mix(in srgb, var(--ink) 88%, var(--bg))`.
  - Disabled is `--surface2` fill, `--border` line, `--muted` ink and `cursor: default`. Never use opacity.
- **Reduced motion.** Under `prefers-reduced-motion: reduce`:
  - `--pulse` becomes none, slides and width transitions are instant, and fades drop to 80ms.
  - Spinners stop and keep their label. State is always carried by the word and the shape, so nothing depends on motion.
  - This replaces `SessionTile`'s deliberate opt-out.
- **Launch.** Read the stored theme before the window shows. Set the Tauri window background from it instead of the hard-coded `#0f1012`.

## Status mark (new, used everywhere a dot was)
The shape carries the state, colour reinforces it, and a word always follows or the accessible name holds it.

| State | Shape | Colour |
| --- | --- | --- |
| running | 8px circle, `--pulse` | `--accent` |
| failing | 7px square rotated 45° | `--danger` |
| needs you / attention | 10×9 triangle (clip-path) | `--warn` |
| done | 8px ring, 1.5px | `--muted` |
| idle / not yet | 4px dot | `--muted` |

It replaces the switch dots, the top-bar dot, toast type dots, rail dots, hook "installed" dots and PR pills.

## Components
All live in `src/lib/components/ui/`. Each row lists anatomy, tokens, states and keyboard.

### Button
- **Variants**
  - `primary`: `--ink` fill with `--ink-text`.
  - `secondary`: `--surface` fill, `--border2` line.
  - `ghost`: transparent, `--muted` ink, `--text` on hover.
  - `danger`: secondary with `--danger` ink; hover border `--danger`.
  - `link`: `--text`, underline in `--border2`, `--text` on hover.
- **Sizes**
  - sm: 24px, 13px text, 8px padding, `--r-md`.
  - md: 28px, 14px text, 12px padding, `--r-lg`.
  - lg: 32px, 14px text, 14px padding, `--r-lg`.
- **Icon-only:** square at the size's height, icon 16 (sm) or 18. `aria-label` is required and a tooltip is shown.
- **Loading:** the leading spinner replaces the icon, the label and width stay, and `aria-busy="true"`.
- **Keyboard:** Enter and Space activate.
- **Rule:** one primary per surface.
- **Replaces** `.btn .key-btn .remove .link .link-ws .primary .secondary .start .send .discard .save .ask .add-row .expand-btn`.

### Field
- **Anatomy:** label (13 medium) → control (`--h-md`, `--surface`, `--border2`, `--r-md`) → help (12 `--muted`) or error (12 `--danger` with the `error` glyph), joined by `aria-describedby`.
- **States:**
  - Focus: `--text` border plus the ring.
  - Error: `--danger` border plus the message.
  - Saved: a `--accent` "saved" tick for 2s after a blur-commit.
- **Variants:**
  - textarea (min 72px, counter)
  - select (`expand_more`, listbox popover)
  - number stepper (− value +, arrow keys step)
  - search with clear (Esc clears, then blurs)
  - chip input (Enter adds; Backspace on empty removes the last chip)
- **Validation:** the repo field validates `owner/name` live after the first blur.

### Checkbox, radio, switch
- **Checkbox:** 16px, `--r-xs`. Checked is an `--ink` fill with a `check` glyph.
- **Radio:** 16px with a 7px `--ink` dot. Real `role="radio"` in a `radiogroup`; arrow keys move.
- **Switch:** 32×18, `--r-pill`.
  - On: `--accent` track with an `--accent-ink` knob.
  - Off: `--surface3` track with a `--border2` inset and a `--muted` knob.
  - `role="switch"`.

### Kbd, badge, status pill, chip
- **kbd:** mono 12, 20px tall, `--border2` with a 2px bottom border. One style only; the opacity variant is removed.
- **Count badge:** 18px, `--r-pill`, `--surface3`.
- **Alert count:** transparent fill, a 1px `--warn` ring and `--warn` text. It replaces white-on-`--warn`, which measured 2:1 in dark.
- **Status pill:** the existing pill plus a status mark.
- **Filter chip:** `--r-pill`, 26px. Selected is `--ink`.
- **Workspace tag:** a colour swatch plus the name in `--text`. The tag colour is never used as text.

### Banner, inline alert, toast
- **Banner:** sits inside a region. Anatomy: icon, title, body, action(s), and an optional dismiss.
  - warn and error take a matching 1px ring; info and success keep `--border`.
  - Errors use `role="alert"`; the rest use `role="status"`.
- **Inline alert:** one line of 12px text under the control that caused it.
- **Toast:** 340px, bottom-right, `--z-toast`, `--elev-2`, `--r-card-lg`.
  - Errors: `role="alert"`, persistent until dismissed.
  - Info and success: 5s. Warn: 8s. Timers pause on hover or focus.
  - At most 3 visible, then "+n in Notifications".
  - Every toast is kept in Notifications (top-bar bell, last 50).
  - Dismiss is an icon-only sm button.

### Tooltip, menu, popover, context menu
- **Tooltip:** `--ink` fill, 12px text, `--r-sm`, `--elev-1`, `--z-tooltip`.
  - Opens after 400ms on hover, at once on focus. Esc closes. Joined by `aria-describedby`.
  - May hold a kbd hint. It never holds information that exists nowhere else.
  - It replaces every `title=` (14 files).
- **Menu and context menu:** `--surface`, `--border2`, `--r-card`, `--elev-1`, 4px padding. Rows are 28px with a 16px icon and a trailing kbd. Separators are `--border`. Destructive rows use `--danger` ink.
  - `role="menu"` / `menuitem`. Arrow keys move, type-ahead works, Enter activates, Esc closes and returns focus.
  - The context menu opens on right-click and on ⇧F10 / the Menu key.
- **Popover:** the same shell with free content and 12px padding. It is a `dialog` when it holds controls.

### Tabs, segmented control
- **Segmented control:** a `--surface2` well, with the active segment on `--surface` with a `--border2` inset.
  - Role is `tablist`/`tab` when it swaps a panel (the top-bar views), and `radiogroup`/`radio` when it sets a value (range, Unified/Split).
  - Its private inks are deleted.
- **Tabs:** for documents and Settings sections. 32–36px tall, 14px text.
  - Selected: `--text` plus a 2px `--ink` underline.
  - Close is an sm icon button; unsaved is a 7px `--text` dot that becomes close on hover or focus.
  - Overflow goes into a "+n" menu.
  - Keys: ←→ move, Home/End jump, ⌘W closes.
  - Settings nav is a vertical tablist, grouped App / Work / System, with search (⌘F).

### List row, tree row
- **List row:** 32px, 8px padding, `--r-md`.
  - Hover `--surface2`. Selected `--surface3` with semi weight. Focused gets the ring at −2px offset. Disabled is `--muted`.
  - Trailing actions show on hover or focus-within and are always repeated in the context menu.
  - In a `listbox`, rows are `option`.
- **Tree row:** 28px, 20px indent per level. A `chevron_right` twisty rotates 90° over `--dur-fast`. File-type icon: `article` for md, `code` for source, `data_object` for json/toml, `folder`/`folder_open` for folders.
  - Roles: `tree` / `treeitem` with `aria-level` and `aria-expanded`.
  - Keys: ↑↓ move, → opens or goes to the first child, ← closes or goes to the parent, Enter opens, F2 renames, Delete deletes (confirm), ⇧F10 opens the menu.

### Empty, skeleton, spinner, progress
- **Empty state:** a 40px `--surface2` circle with a 20px icon, then title (14 semi), one sentence (13 `--muted`) and an optional sm secondary action.
- **Compact empty:** one line with an icon and text, for tree sections and rail tiles.
- **Skeleton:** `--surface3` bars at the final layout with `--pulse`; `aria-busy` on the region.
- **Spinner:** `progress_activity` + `atlasSpin` 0.9s, always beside a label. Show nothing for loads under 1s.
- **Progress:** a 2px bar, `--surface3` track, `--accent` fill, with a mono count.

### Modal, drawer, destructive confirm
- **Modal:** `--r-modal`, `--border2`, `--elev-2`, widths 420 / 560 / 720.
  - Header 44px: title (15 semi, `id` referenced by `aria-labelledby`) plus a close button.
  - Body with 16px padding. The body scrolls; the panel no longer clips at 500px tall.
  - Footer: right-aligned buttons, secondary then primary.
  - Focus is trapped and restored (keep `Modal.svelte`'s logic). Esc closes in Modal itself.
- **Drawer:** slides in from the right over `--dur-slow` `--ease-out`, `--z-drawer`, with the same header and footer.
- **Destructive confirm:** a 420 modal. Title is the question ("Discard 4 review comments?"). Body states what is lost and that it can't be undone. Buttons: Cancel (focused first) and a danger button named with the verb.
  - Prefer an undo toast wherever the action can be reversed.

### Icons and mark
- **Icons:** Material Symbols Outlined only, at wght 400, opsz 20, 16 or 18px, `--muted` at rest. Regenerate the subset with `scripts/subset-icons.py` for the 36 glyphs on the sheet (§3).
- **Remove:** the inline SVG rail toggle and every Unicode stand-in (✕ ▥ ↑ ↗ ← ▸ › − +).
- **Mark:** an ink rounded square with a 2×2 grid, one cell open. 20px beside the wordmark; 40px in empty, first-run and About screens. `›_` is retired; actions that used it take the `terminal` glyph.

---

## Connectors (`Connectors.dc.html`)
Everything is provider-neutral. A connector definition supplies the provider name, kind (tickets or pull requests), logo slot (drawn as a 32px `--surface3` square with the initial until real logos exist), auth flow and URLs. Tokens live in the OS keychain.

- **Connector row states:**
  - not linked: small dot, Connect (primary sm)
  - linked: ring in `--accent`, "Linked as …", Disconnect (danger sm)
  - reconnect needed: triangle, `--warn` ring on the row, Reconnect plus Disconnect
  - error: diamond, `--danger` ring, Retry plus Disconnect
- **Watched repositories:** they live under the pull request connector, with add-by-owner/name and live validation. After the first link, repos watched through gh are offered back.
- **Device-code dialog:**
  - The code is shown large in mono with Copy (⌘C), plus the verification link and "Open sign-in page".
  - A waiting line has a spinner and a mono countdown that turns `--warn` under 1 minute.
  - Outcomes: denied (Try again), expired (Get a new code), failed (Retry with the provider error).
- **Browser-redirect dialog:** "Finish in your browser" with a waiting line, plus a Copy sign-in link and Cancel. Port busy is an error with "Use a code" as the fallback.
- **Disconnect:** a confirm dialog that says what stops updating and that repositories are kept.
- **Token expiry elsewhere:** one persistent error toast per connector per expiry, and a top-bar chip ("GitHub needs reconnecting", triangle). The chip opens a popover with Reconnect and leaves when every connector is healthy.
- **Pull requests screen:**
  - no connector: an empty state with Open Connectors
  - linked, no repos: inline add plus workspace suggestions
  - checkout failure: a row-level alert with the git command, Copy and Retry
  - rows expand to show checks individually (failing, review, running, then passed folded)

## Rail (`Rail States.dc.html`)
- **Ticket header**
  - **Linked:** the ⋯ menu offers Change (E), Open in provider, Copy ID and Unlink.
  - **No ticket:** a Link ticket button (L).
  - **Editor:** replaces the ticket block in place.
    - Input, plus a suggestion chip parsed from the branch name.
    - Enter links, Esc cancels. Validating shows a spinner. Not found shows the error under the field. Unauthorized shows a warn line plus "Reconnect →". Offline shows a status line plus Retry.
  - **No connector:** "Link <provider> →" opens Settings → Connectors.
  - **Fetching:** tickets are fetched once; on failure the header shows Retry.
- **Tiles**
  - **First load:** skeletons.
  - **Failed refresh:** keep the last good data in `--muted` ink, add a footer "couldn't refresh · 2m ago · Retry" and a `--warn` ring.
  - **PR connector states:** Link → / Reconnect → / no pull request for the branch / rate limited (with the next try time).
  - **Refresh timing:** PRs refresh every 60s while the rail is visible and pause otherwise.
- **48px rail**
  - **Toggle:** the `right_panel_close` / `right_panel_open` icon button (⌘\), animating 300↔48 over `--dur-slow`. Content fades in the first 80ms.
  - **Contents:** the ticket ID set vertically, a waiting triangle, and one mark per tile with the letter P, A or PR.
  - **Each mark** is a button whose accessible name is the full sentence, with a tooltip on hover and focus. Enter expands the rail at that tile; ↑↓ move between marks.
  - **Persistence:** tile open/closed choices persist globally; "+n more" and done folds don't.
  - **Narrow windows:** below 1000px the rail starts thin.

## Screens (`Screens – *.dc.html`)
- **Top bar.** The mark is added.
  - Status line by width: at 1400 it shows all counts; at 1100, running and needs-you only; at 800, a compact chip with shapes.
  - Jump becomes an icon at 800.
  - The live mark shows only while something runs. A notifications bell is added.
  - macOS: the bar is the drag region with a 76px inset, and the 28px strip is removed. Windows: the native title bar stays above.
- **Session tile.** It becomes an `article` whose label is the link.
  - Pin, close, Deny and Allow are siblings, always visible at 24px.
  - Hover is a `--border2` ring, no shadow. Focus uses the `--focus` ring.
  - The workspace shows as a swatch plus the name. `+0 −0` is hidden.
  - The amber action bar stays and uses the triangle mark.
- **Session view.**
  - Back is an icon button with a label.
  - The switch dots become an "Other sessions" menu button with counts by shape.
  - The rail toggle uses the icon.
  - The footer keeps the last tool plus the transcript state; totals live only in the rail header.
  - At 800×500 the rail is thin, and the header drops the branch and the Changes label.
  - Designed empty states for an ended session and for no session selected.
- **Jump / New Session.** A combobox plus listbox. Mode is a segmented control (New / Resume / From PR). Harness is a radiogroup. Loading shows skeleton rows; no match offers ⌘↵ to create.
- **Changes drawer.** The file header is a disclosure button with a sibling Viewed checkbox. Comment threads use the field and sm buttons. "Discard…" opens a confirm.
- **Files.** A real tree with type icons and compact empty lines that offer an action. Tabs have unsaved dots and overflow. The conflict bar is the shared banner (Compare / Keep mine / Load disk).
- **Stats.** See `docs/chart-guidance.md`.
- **Settings.** Grouped nav with search, plus the copy pass (table in Work Views §4).
- **Drag and drop.** A full-window drop target ("Drop to add as a workspace"), which makes the existing copy true.
- **App states.**
  - first run: checklist plus drop zone
  - Claude Code not found: blocking error with install, choose executable and check again
  - hooks out of date / tailing off: banners above the grid
  - update ready: a quiet top-bar chip plus About
  - crashed view: a per-view error boundary with Reload view, Copy details and Open logs

## Sequencing (suggested)
1. Tokens, focus ring, reduced motion, launch-flash fix.
2. Button, field, icon-only button, kbd, status mark, then swap them in everywhere (audit Tier 1).
3. Tooltip (removes `title=`), banner, toast rules, Notifications.
4. List/tree rows, tabs, menus, then Files and the palettes.
5. Connectors, rail states, PR screen.
6. Stats charts, Settings regroup and copy, app-level states.
