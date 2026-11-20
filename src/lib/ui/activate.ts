/** Enter or Space on a focusable non-button row (role="option") clicks it, as a button would. */
export function activateOnKey(e: KeyboardEvent) {
  const el = e.currentTarget as HTMLElement;
  if (e.target !== el || el.getAttribute("aria-disabled") === "true") return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    el.click();
  }
}
