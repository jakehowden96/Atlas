import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "svelte/compiler";
import { describe, expect, it } from "vitest";

// Svelte 5 drops whitespace at the start and end of an element's or block's content, so
// `<span>, </span>` renders as "," and `Bash{#if x}⏎ · {x}{/if}` as "Bash· x": words run
// together. Put edge spaces in an expression instead: `<span>{", "}</span>`.
type Node = { type: string; name?: string; data?: string; start: number } & Record<string, unknown>;
type Fragment = { nodes: Node[] } | null | undefined;

const INLINE = new Set(["span", "a", "b", "strong", "em", "i", "code", "small", "label", "kbd"]);
const endsWs = (n?: Node) => n?.type === "Text" && /\s$/.test(n.data!);
const startsWs = (n?: Node) => n?.type === "Text" && /^\s/.test(n.data!);

/** Edge text whose dropped whitespace sat against inline content outside the element/block. */
function lostSpaces(src: string): string[] {
  const found: string[] = [];
  const check = (frag: Fragment, prev?: Node, next?: Node) => {
    const ns = frag?.nodes;
    if (!ns?.length) return;
    const a = ns[0]!;
    const z = ns[ns.length - 1]!;
    if (a.type === "Text" && /^\s+\S/.test(a.data!) && prev && !endsWs(prev)) found.push(a.data!);
    if (z.type === "Text" && /\S\s+$/.test(z.data!) && next && !startsWs(next)) found.push(z.data!);
  };
  const walk = (frag: Fragment): void => {
    const ns = frag?.nodes ?? [];
    ns.forEach((n, i) => {
      const prev = ns[i - 1];
      const next = ns[i + 1];
      const kids = (k: string) => n[k] as Fragment;
      if (n.type === "IfBlock") {
        for (const k of ["consequent", "alternate"]) {
          check(kids(k), prev, next);
          walk(kids(k));
        }
      } else if (n.type === "EachBlock") {
        check(kids("body"), prev, next);
        walk(kids("body"));
        walk(kids("fallback"));
      } else if (n.type === "KeyBlock") {
        check(kids("fragment"), prev, next);
        walk(kids("fragment"));
      } else if (n.type === "AwaitBlock") {
        for (const k of ["pending", "then", "catch"]) {
          check(kids(k), prev, next);
          walk(kids(k));
        }
      } else {
        if (n.type === "RegularElement" && INLINE.has(n.name!)) check(kids("fragment"), prev, next);
        walk(kids("fragment"));
        walk(kids("body"));
      }
    });
  };
  walk(parse(src, { modern: true }).fragment as unknown as Fragment);
  return found;
}

describe("svelte templates", () => {
  const root = join(process.cwd(), "src");
  const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) =>
    f.endsWith(".svelte"),
  );

  it("never lose a space between words to Svelte's edge-whitespace trimming", () => {
    const bad = files.flatMap((f) =>
      lostSpaces(readFileSync(join(root, f), "utf8")).map((t) => `${f}: ${JSON.stringify(t)}`),
    );
    expect(bad).toEqual([]);
  });

  it("flags the pattern", () => {
    expect(lostSpaces(`a<span>, </span>b`)).toEqual([", "]);
    expect(lostSpaces(`Bash{#if x}\n  · {x}{/if}`)).toEqual(["\n  · "]);
    expect(lostSpaces(`a<span>{", "}</span>b<div>\n  x\n</div>`)).toEqual([]);
  });
});
