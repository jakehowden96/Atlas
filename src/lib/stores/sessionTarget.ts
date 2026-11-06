import { writable } from "svelte/store";

/** A session id the Sessions page should open; Overview sets it, Sessions clears it once shown. */
export const sessionTarget = writable<string | null>(null);
