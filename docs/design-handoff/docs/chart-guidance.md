# Stats chart guidance

The Stats charts are currently hand-built divs with no axes, no labels, `title=` hovers and a colour-only heatmap. These rules apply to every Stats chart. Keep the charts quiet: one series colour unless the chart compares series.

## Structure
- **Every chart is a `figure`** with a visible title (`--fs-sm` semi) and a `figcaption`. The caption is a one-line summary in words ("Spend peaked Tuesday at $18.40"). Screen readers get the caption first.
- **Axes.**
  - Y axis: 3 to 4 gridlines in `--border`, labels in mono `--fs-2xs` `--muted`, right-aligned, with units ("$0", "$10", "$20").
  - X axis: label every bar when there are 7 or fewer; otherwise label the first, middle and last.
  - The baseline is `--border2`.
- **Direct labels over legends.** Label the max value on the bar itself, in mono `--fs-2xs`. When there are 2 or more series, label each line's end instead of using a legend box.
- **Empty range.** Draw the axes and an empty-state line inside the plot ("No sessions between 1 and 7 Oct"). Never leave a blank card.
- **Loading.** Use a skeleton in the plot area at the final size. Do not show "Scanning transcripts…".

## Colour
- **Single-series charts** (spend, sessions, tool calls) use `--accent` bars.
- **Model comparisons** use `--model-opus`, `--model-sonnet` and `--model-haiku` as fills only, never as text.
  - The name is always written next to the mark in `--text`.
  - A model colour fill must reach 3:1 against its ground. All three do on `--surface` in dark. In light, Haiku (#e089b8) is about 2.3:1 on white, so add a 1px `--text` 40% outline to light-theme model fills.
  - These fixes are about contrast against the ground. Separately, each model also gets a distinct texture (hatching or a dot pattern) so the series stay apart without colour.
- **Heatmap.**
  - Use 5 steps from `--surface3` to `--accent` via `color-mix(in srgb, var(--accent) N%, var(--surface3))` (N = 0, 25, 50, 75, 100).
  - Each cell carries its value in `aria-label` ("Tue 14 Oct, 6 sessions").
  - A legend strip gives the step thresholds in numbers.
  - The busiest cell gets a 1px `--text` ring and its value is written beside the grid.

## Interaction
- **Every mark is reachable by keyboard.** The chart is one tab stop (`role="group"`). Arrow keys move between marks; Home and End jump to the ends.
- **Tooltips** use the component tooltip (ink, `--fs-2xs`). They open on hover after 0ms (charts are scanned), and on focus. Content: the date, the value with its unit, and comparison context ("$18.40 · 2.3× the 7-day median"). Esc closes.
- **Focused mark:** a 2px `--focus` outline offset 1px. The value in the tooltip also appears in a live region below the chart.
- **Click** pins the tooltip and filters the sessions table below to that bucket.

## Table alternative
- Each chart card has a "Table" segmented toggle (Chart / Table). The table shows the same data with a mono, right-aligned number column and a sortable header.
- The choice persists per chart.
- Copy as CSV sits in the card's ⋯ menu.

## KPIs
- Each KPI shows: the number (mono `--fs-xl`), the label (`--fs-2xs` `--muted`), and a delta in words with a sign ("+12% vs last week"). Colour the delta only if it crosses a set threshold, never for direction alone.
- A Sparkline (64×20) is optional and decorative (`aria-hidden`). The delta text carries the meaning.
