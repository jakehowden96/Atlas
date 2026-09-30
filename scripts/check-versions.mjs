// Fails when package.json, src-tauri/Cargo.toml and src-tauri/tauri.conf.json
// disagree on the app version. Tauri reads all three, so they are kept in sync
// by hand rather than derived from one source.
//
// With an argument (a tag such as v2.1.0) it also checks the tag matches.
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const cargo = read("src-tauri/Cargo.toml").match(/^\[package\][^[]*?^version\s*=\s*"([^"]+)"/ms);
const versions = {
  "package.json": JSON.parse(read("package.json")).version,
  "src-tauri/Cargo.toml": cargo?.[1],
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
};

const tag = process.argv[2];
if (tag) versions[`tag ${tag}`] = tag.replace(/^v/, "");

const distinct = new Set(Object.values(versions));
for (const [file, version] of Object.entries(versions)) console.log(`${file}: ${version}`);
if (distinct.size !== 1 || distinct.has(undefined)) {
  console.error("Version mismatch");
  process.exit(1);
}
