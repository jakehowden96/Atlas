import { writable } from "svelte/store";
import type { Filters } from "../../types/codeburn";

/** The Stats screen's filters; StatsView passes them to every page, which builds its argv with `filterArgs`. */
export const statsFilters = writable<Filters>({ period: "30days" });
