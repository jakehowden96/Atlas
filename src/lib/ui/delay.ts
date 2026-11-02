/** Loads shorter than this show nothing, so fast loads never flash a spinner. */
export const LOADING_DELAY_MS = 1000;

/** Reports `true` only once `active` has stayed true for `ms`; `false` at once. */
export function delayedFlag(onChange: (visible: boolean) => void, ms = LOADING_DELAY_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    set(active: boolean) {
      clearTimeout(timer);
      if (active) timer = setTimeout(() => onChange(true), ms);
      else onChange(false);
    },
    destroy() {
      clearTimeout(timer);
    },
  };
}
