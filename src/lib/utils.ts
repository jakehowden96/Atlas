import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { createTV } from "tailwind-variants";

// Atlas's extra theme steps, so twMerge reads `text-caption` as a size (not a colour) and keeps both.
const twMergeConfig = {
  extend: {
    theme: {
      text: ["caption", "md"],
      shadow: ["elev-0", "elev-1", "elev-2"],
      radius: ["xs"],
    },
  },
};
const twMerge = extendTailwindMerge(twMergeConfig);

/** tailwind-variants with the same merge rules as `cn`. Import `tv` from here, not from the package. */
export const tv = createTV({ twMergeConfig });
export type { VariantProps } from "tailwind-variants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// biome-ignore lint/suspicious/noExplicitAny: shadcn-svelte helper types
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// biome-ignore lint/suspicious/noExplicitAny: shadcn-svelte helper types
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
