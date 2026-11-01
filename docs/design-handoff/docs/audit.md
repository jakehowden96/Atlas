# Atlas UI audit

Ranked by how visible each problem is to someone using Atlas all day, most visible first. Every item comes from the source on `main`. Items marked **new** are in addition to the brief.

Tags: `component` · `state` · `a11y` · `content` · `missing`

Fix column: where the fix lives (C = `Atlas Components.dc.html`, R = `Rail States.dc.html`, X = `Connectors.dc.html`, S = `Screens.dc.html`, T = `tokens/additions.css`).

## Tier 1: seen on every screen, every session

| # | Where | Finding | Tags | Fix |
|---|---|---|---|---|
| 1 | Every screen | No shared Button. Hand-rolled classes include `.btn`, `.key-btn`, `.remove`, `.link`, `.link-ws`, `.primary` / `.secondary`, `.start`, `.send`, `.discard`, `.save`, `.ask`, `.add-row`, `.expand-btn` and bare "Open →". Each has its own height, radius and hover. | component | C §4 |
| 2 | Every screen | Ten control heights (20 to 44px), 26 most common, with no scale behind them. | component | T `--h-*`, C §1 |
| 3 | Every screen | Only 7 of 30 components declare `:focus-visible`. Files, PRs, Stats, the rail, toolbar buttons and every dialog show the UA ring or nothing. | a11y | T `--focus`, C §2 |
| 4 | Top bar `App.svelte` | The `.status-dot` pulses `--accent` forever, including at 0 running. It is a colour-only "live" signal with no meaning attached. | state · a11y | S top bar |
| 5 | Top bar `App.svelte` | **new** At 800px the bar needs about 1100px: wordmark, segmented control (about 370), mono status line (about 330, `nowrap`), Jump (min 140), "+ Session", gear and gaps. Nothing wraps, hides or truncates, so the right side clips. It is already tight at 1100px. | state | S top bar |
| 6 | Top bar `App.svelte` | **new** A private `--warn-ink: #8f6200` sits in the component. It is stale: `--warn` was darkened to 4.5:1 in `app.css`. Light theme now has two ambers, and there is a hard-coded hex. | component · content | delete; use `--warn` |
| 7 | View switch `SegmentedControl.svelte` | **new** The PRs alert badge is `#fff` on `--warn`. In dark, `--warn` is `#e0a53a`, which puts white text at about 2:1. | a11y | C §6, ringed count |
| 8 | `SegmentedControl.svelte` | Private ink tokens (`--seg-ink`, `--seg-count`, `#fff`), a stale "11.5px" comment, a literal 5px radius, an inline rgba shadow, and disabled at opacity .45. | component | C §9 |
| 9 | Icons, app-wide | Three icon systems: a Material Symbols subset, one inline SVG, and Unicode stand-ins (✕ ▥ ↑ ↗ ← ▸ › − +). `›_` is used as a logo in Jump, New Session, the Sessions empty state, "Ask Claude ›_" and "Work on it ›_". | component | C §3 |
| 10 | Icons, app-wide | **new** The icon size is set twice: `app.css` uses 24px and `App.svelte` uses `1.25rem`. Both are off the type scale. | component | C §3 (16/18) |
| 11 | Session header `SessionView.svelte` | Switch dots are 10px, colour-only, with `title=` only. **new** They are unbounded `flex` with no wrap or limit, so 10+ sessions push Changes and the rail toggle off-screen. | a11y · state | S session header |
| 12 | Session header `SessionView.svelte` | **new** The workspace chip sets the name in the tag colour at weight 700, on a 34% fill of the same colour, with a 20px literal radius. Contrast is unchecked for arbitrary tag colours. | a11y · component | C §6 (swatch + `--text`) |
| 13 | Session header and footer | Tool, context and cost totals appear in the tile footer, the session footer and the rail (v6 adds the header strip as a fourth). | content | S: footer drops totals |
| 14 | Session footer | **new** Shows "—" when there is no tool yet. Changes shows `+0 −0` in accent and danger when there is no diff, so colour implies state at zero. | state · content | S |
| 15 | `Toast.svelte` | Errors use `aria-live="polite"`. Type is a colour-only 8px dot. Toasts cap at 4 with no history. **new** The close control is a bare ✕ with `padding: 0` (a 14px hit target), and the radius is a 9px literal. | a11y · component · missing | C §7 |
| 16 | `title=` tooltips | 14 files use native `title=`, including icon-only buttons and every chart mark: slow, unstyled, keyboard-invisible. | a11y | C §8 |
| 17 | Motion | About 12 animated components and no `prefers-reduced-motion` anywhere. **new** `SessionTile.svelte` says in a comment it deliberately does not gate its activity animation. | a11y | T reduced-motion block |

## Tier 2: on a primary screen, seen daily

| # | Where | Finding | Tags | Fix |
|---|---|---|---|---|
| 18 | `SessionTile.svelte` | The tile is `role="button"` and contains pin, close, Allow and Deny buttons (nested interactive). | a11y | S tile: the label is the link, actions are siblings |
| 19 | `DiffFileCard.svelte` | **new** Six `role="button"` divs, including a header that contains the "Viewed" checkbox. | a11y | S drawer |
| 20 | `ChangesDrawer.svelte` | "Discard" deletes every review comment with no confirm and no undo. | missing · state | C §11 confirm |
| 21 | Files `FileTree.svelte` | Not a tree: no `tree` / `treeitem`, no arrow keys, a rotated `›` for folders, generic bullets for files, and "Nothing yet" three times. | a11y · component | C §9 tree row |
| 22 | Files `FileEditor.svelte` | File tabs have no role and no overflow design. Close is ✕ text. | a11y · component | C §9 tabs |
| 23 | Files `FileTree.svelte` | **new** The workspace switcher is a native `<select>` styled differently from every other control. | component | C §5 select |
| 24 | PRs `PrsView.svelte` | One flat list per repo, no sort or search. Errors are plain red mono text ("run gh auth login"). **new** The ↗ button is labelled "Open on GitHub", which is provider-specific. | component · content · state | X §3 |
| 25 | Stats `StatsView.svelte` | Hand-built div charts: no axes, no value labels, `title=` hovers, a colour-only heatmap, model colours used as text without contrast checks. | a11y | docs/chart-guidance.md |
| 26 | Loading | Bare text: "Loading…" (PRs), "Scanning transcripts…" (Stats), "Reading transcripts…" (Resume). | state | C §10 |
| 27 | Empty states | One-liners across at least five class names: `.empty`, `.none`, `.blank`, `.message`, `.resume-empty`, `.empty-card`. | state · component | C §10 |
| 28 | Errors | `.card-error`, `.list-error`, Stats' unstyled Retry and toasts. There is only one real inline alert (the Files conflict bar). | component | C §7 |
| 29 | `TerminalContainer.svelte` | The empty-terminal text is at 50% opacity over `--muted` and fails contrast. | a11y | S session empty |
| 30 | `TerminalTab.svelte` | **new** The loading overlay is `role="alert"`, so every terminal load is announced as an alert. | a11y | use `role="status"` |
| 31 | `ui/Modal.svelte` | Dialogs have `aria-modal` but no accessible name. **new** The panel is `overflow: hidden` with `max-height: 100vh − 96px`, so at the 500px minimum window height, tall dialogs (Settings, New Session) clip instead of scrolling. | a11y · state | C §11 |
| 32 | New Session | Resume radios are drawn in CSS with no `radio` role. | a11y | C §5 |
| 33 | Jump and New Session palettes | No `combobox` / `listbox` / `option`. | a11y | S palettes |

## Tier 3: Settings, secondary screens and edges

| # | Where | Finding | Tags | Fix |
|---|---|---|---|---|
| 34 | `SettingsModal.svelte` | A single 40KB file, seven tabs, a plain-button nav, no search and no grouping. | component | X §1 nav |
| 35 | Settings → Harnesses | Removing a harness has no confirm or undo (workspace removal has undo). Fields commit on blur with no saved or error feedback. | missing · state | C §5 "saved" |
| 36 | Settings → Pull requests | The repo input has no format validation. The `gh auth status: ok · @login` row is replaced by Connectors. | state · content | X §1 |
| 37 | Settings copy | Internals leak into copy: "no proxying", "Plan, subagents, tool calls and cost are not hooks…", "via gh · refreshed … · every 5m". | content | S settings copy |
| 38 | Settings → Workspaces | "or drop a folder anywhere in Atlas" promises drag-and-drop, and no handler exists. | missing · content | S drop target |
| 39 | Settings → General | **new** Terminal font size uses `−` / `+` glyph buttons. | component | C §5 stepper |
| 40 | `Toggle.svelte` | **new** The knob is `#fff` with an inline rgba shadow. | component | C §5 |
| 41 | `Chip.svelte` | **new** The count sits at opacity .7, about 3.8:1 on the selected ink chip. The radius is a 13px literal. | a11y · component | C §6 |
| 42 | Top bar | **new** Two `kbd` styles side by side: a boxed `.kbd` for Jump and an opacity-.6 `.kbd-inline` for "+ Session". | component | C §6 kbd |
| 43 | Radii | Literals 2, 5, 9, 13, 14 and 20px alongside the token scale. | component | T `--r-pill`, existing scale |
| 44 | Elevation and layers | One elevation token; tile shadows are inline rgba. z-index values are 1, 4, 20, 30 and 1000. | component | T `--elev-*`, `--z-*` |
| 45 | Copy | **new** Trailing punctuation and em dashes break the content rules: "This folder is empty.", "No sessions yet.", "No watched repos yet.", "No prior sessions in this workspace yet — start a New one." | content | S copy list |
| 46 | Launch | The window background is hard-coded `#0f1012`, so light-theme users see a dark flash. | state | read the theme before window show |
| 47 | Responsive | No media or container queries anywhere. The Session header and the 3-column Stats grid are undesigned at 800px. | state | S widths |

## Where two screens solve one problem differently, pick one

- **Close:** ✕ text, a 26px icon button and a bare `.remove` → one icon-only ghost button (`close` glyph), sm inside rows, md in headers.
- **Kbd hint:** boxed and opacity variants → boxed `kbd` only. Inside an ink button the kbd sits at `--ink-text` 70%.
- **Empty:** six classes → the empty state (centred) and the compact variant (one line, for rails and tree sections).
- **Error:** `card-error`, `list-error`, red text and a toast → a banner when it blocks a region, an inline alert under the control that caused it, and a toast only when the user is elsewhere.
- **Disabled:** opacity .45 or .5 → the disabled recipe (`--surface2`, `--border`, `--muted`).
- **Selected:** ink-fill chip, hairline segment, bold row → `--ink` fill for filter chips only; a `--surface` + `--border2` ring for segments; a `--surface3` fill + semi weight for list and tree rows.
- **Destructive:** a danger hover on ✕, red text and immediate delete → undo toast when reversible; confirm dialog (Cancel focused) when not.
