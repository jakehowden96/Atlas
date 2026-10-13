import { writable } from "svelte/store";

/*
 * The two Files-screen stores that are persisted with the settings. They live
 * apart from `stores/files.ts` so `settings.ts` (which saves them) and
 * `files.ts` (which edits them through settings' setters) do not import each
 * other.
 */

/** Open file keys in tab order. Persisted — see `stores/settings.ts`. */
export const openFiles = writable<string[]>([]);
/** Folders registered from disk. Phase 04 lists them; persisted like `openFiles`. */
export const sources = writable<string[]>([]);
