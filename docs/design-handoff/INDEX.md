# Design handoff index

Reference material from Claude Design for the Atlas polish pass. Not production code.

## Files
- `README.md`: system handoff. Component specs, tokens, connectors, rail, screens.
- `session-rail-README.md`: original session rail spec, with overrides noted at its top.
- `docs/audit.md`, `docs/product-gaps.md`, `docs/chart-guidance.md`: audit and supporting notes.
- `tokens/`, `fonts/`, `styles.css`: design tokens, fonts and base styles used by the references.
- `Atlas Components.dc.html`: component frames.
- `Connectors.dc.html`: connector frames.
- `Rail States.dc.html`, `Session Rail v6.dc.html`: session rail frames.
- `Screens - Shell and Sessions.dc.html`, `Screens - Work Views.dc.html`: screen frames.

## Viewing
Open the `.dc.html` files in a browser from this folder. `support.js` is their runtime.

## Overrides (recorded at the top of `session-rail-README.md`)
1. Tile open/closed choices persist globally per tile type, not per session.
2. The PR tile refreshes every 60s, not 30s, and only while the rail is visible.
3. The ticket is linked by the user typing an ID per session, from a connector, not inferred from the branch.
4. PR data comes from a GitHub connector over HTTPS, not `gh pr view`, so the `gh failed` copy becomes provider-neutral.
5. Tile order, copy and layout are otherwise as written.

Also: wherever the design shows a provider as a letter in a square, use the real logo via `ConnectorLogo` / `ConnectorLogoTile`.

## Note
The HTML, CSS and JS here are reference only. Recreate the designs in Svelte; never copy their markup or inline styles.
