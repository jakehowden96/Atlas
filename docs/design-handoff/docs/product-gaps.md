# Product gaps

These are not styling problems. Each one is a place where the product is missing behaviour: a state with no UI, an action with no feedback, a dead end, or a promise with no feature behind it. Ordered by how often someone will hit it.

## States with no UI
1. **Claude Code not found.** There is no screen for this. Sessions fail when they spawn. Design: S app states.
2. **Hooks not installed or out of date.** The only signal is a Settings row, and needs-you alerts silently stop working. Design: a banner on Sessions plus a first-run step.
3. **Transcript tailing off.** When the tail stops, tiles and the rail freeze with no indicator. Design: R §2 "Transcript stopped updating", plus a tile footer note.
4. **Offline.** There is no global state. Connector refreshes fail one by one. Design: one top-bar chip ("Offline · showing data from 11:42") instead of a toast per failure.
5. **First run.** There are no workspaces and no onboarding; the user lands on an empty grid. Design: S app states.
6. **Crashed view.** There is no error boundary, so one throwing component blanks the window. Design: a per-view boundary with Reload view, Copy error and Open logs.
7. **Update available, and About.** There is no update mechanism or version page. Design: Settings → About and updates, plus a quiet top-bar notice.
8. **Narrow window.** The minimum window is 800×500 and nothing adapts to it. Design: S at 800px.

## Actions with no feedback
9. **Harness fields** commit on blur with no saved or failed state.
10. **Closing a session** ends it and sends you back to Sessions without saying it is resumable. Add an "Ended billing-retry · Resume" toast.
11. **Checkout from a PR** ("Work on it") has no progress or failure state. Design: X §3.
12. **Copying** (paths, codes, commands) has no confirmation. Use an inline "copied" label for 2s.

## Destructive actions with no safety net
13. **Discard review comments** deletes everything with no confirm and no undo.
14. **Removing a harness** has no confirm and no undo (workspace removal already has undo).

## Dead ends
15. **Toast history.** Errors that scrolled away cannot be found again. Add Notifications (a bell in the top bar, last 50).
16. **PR checks.** Pills summarise checks, but you cannot see which check failed or open its log. Design: X §3.
17. **Files.** There is no rename, delete, new folder or context menu. "Nothing yet" offers no way to add anything.
18. **Stats.** There is no table or export; the numbers are only reachable through hover.
19. **PRs.** There is no sort, search or filter. Long repo lists can only be scrolled.

## Promises with no feature
20. **Settings → Workspaces** says "or drop a folder anywhere in Atlas", and no drop handler exists. Recommendation: build the drop target (S app states), because it is the fastest way to add a workspace. If it is not built this pass, remove the copy.

## New with connectors
21. **Repos watched through gh** need a migration path. Offer them back after the first PR connector link (X §1 info line).
22. **One expired token** can affect several screens (rail, PRs, ticket header). One persistent indicator covers them all (X §4).
23. **Provider-specific copy** ("Open on GitHub", "gh auth") has to come from the connector definition.
