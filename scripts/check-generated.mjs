// Fails when src/types/generated is not exactly what `cargo test` produces.
//
// ts-rs writes the TypeScript side of the IPC contract during `cargo test`.
// This deletes the directory first, so a type removed from Rust leaves no
// orphan behind, regenerates it, and then compares the result with the
// committed tree: a stale file shows up as a modification, an orphan as a
// deletion and a new type nobody committed as an untracked file.
//
//   node scripts/check-generated.mjs
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const dir = "src/types/generated";

rmSync(`${root}${dir}`, { recursive: true, force: true });
execFileSync("cargo", ["test", "export_bindings"], {
  cwd: `${root}src-tauri`,
  stdio: ["ignore", "ignore", "inherit"],
});

// Only what differs from the index: XY columns, Y = work tree. Staged-only
// changes (a fresh `git add`) are not drift.
const drift = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", dir], {
  cwd: root,
  encoding: "utf8",
})
  .split("\n")
  .filter((line) => line.startsWith("??") || (line !== "" && line[1] !== " "));
if (drift.length > 0) {
  console.error(`${dir} is out of date with the Rust types:\n${drift.join("\n")}`);
  console.error("Run `cargo test` in src-tauri and commit the result.");
  process.exit(1);
}
console.log(`${dir} is up to date`);
