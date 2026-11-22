/**
 * Every app component needs a Storybook story: fails when a `.svelte` file under
 * components/app is not imported by any `*.stories.svelte`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src/lib/components");

/** App wiring with no UI of its own; the Screens stories mount them through App. */
const ALLOWED = new Set(["Overlays.svelte", "ViewHost.svelte"]);

const walk = (dir: string): string[] =>
  (readdirSync(dir, { recursive: true }) as string[]).map((f) => join(dir, f));

/** Component files with no story importing them, by bare file name. */
export function uncovered(components: string[], stories: string): string[] {
  return components
    .map((f) => basename(f))
    .filter((name) => !ALLOWED.has(name) && !stories.includes(`/${name}"`));
}

describe("storybook coverage", () => {
  const all = walk(ROOT);
  const components = walk(join(ROOT, "app")).filter(
    (f) => f.endsWith(".svelte") && !f.endsWith(".stories.svelte"),
  );
  const stories = all
    .filter((f) => f.endsWith(".stories.svelte"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  it("has a story for every app component", () => {
    expect(uncovered(components, stories)).toEqual([]);
  });

  it("flags a component no story imports", () => {
    expect(uncovered(["x/Lonely.svelte", "x/Seen.svelte"], 'import S from "../x/Seen.svelte";')).toEqual([
      "Lonely.svelte",
    ]);
  });
});
