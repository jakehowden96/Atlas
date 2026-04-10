import { describe, it, expect } from "vitest";
import { parseDiff } from "../diff-parser";

const SINGLE_FILE_DIFF = `diff --git a/src/model.py b/src/model.py
index abc1234..def5678 100644
--- a/src/model.py
+++ b/src/model.py
@@ -24,4 +24,4 @@ class TransformerModel(nn.Module):
     def __init__(self, d_model, nhead):
-        self.dropout = nn.Dropout(0.1)
+        self.dropout = nn.Dropout(0.25)  # Increased for stability
         self.encoder = nn.TransformerEncoderLayer(...)`;

const MULTI_FILE_DIFF = `diff --git a/src/model.py b/src/model.py
index abc1234..def5678 100644
--- a/src/model.py
+++ b/src/model.py
@@ -24,3 +24,3 @@ class TransformerModel(nn.Module):
     def __init__(self, d_model, nhead):
-        self.dropout = nn.Dropout(0.1)
+        self.dropout = nn.Dropout(0.25)
diff --git a/src/train.py b/src/train.py
index 1111111..2222222 100644
--- a/src/train.py
+++ b/src/train.py
@@ -10,3 +10,4 @@ def train():
     model = TransformerModel()
+    model.compile()
     optimizer = Adam(lr=0.001)`;

const NEW_FILE_DIFF = `diff --git a/src/utils.py b/src/utils.py
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/utils.py
@@ -0,0 +1,3 @@
+def helper():
+    pass
+    return True`;

const DELETED_FILE_DIFF = `diff --git a/old_module.py b/old_module.py
deleted file mode 100644
index abc1234..0000000
--- a/old_module.py
+++ /dev/null
@@ -1,2 +0,0 @@
-def old_func():
-    pass`;

const RENAMED_FILE_DIFF = `diff --git a/old_name.py b/new_name.py
similarity index 95%
rename from old_name.py
rename to new_name.py
index abc1234..def5678 100644
--- a/old_name.py
+++ b/new_name.py
@@ -1,3 +1,3 @@
 def func():
-    return 1
+    return 2`;

describe("parseDiff", () => {
  it("returns empty array for empty input", () => {
    expect(parseDiff("")).toEqual([]);
    expect(parseDiff("  \n  ")).toEqual([]);
  });

  it("parses a single-file diff with add and remove", () => {
    const files = parseDiff(SINGLE_FILE_DIFF);
    expect(files).toHaveLength(1);

    const file = files[0];
    expect(file.oldName).toBe("src/model.py");
    expect(file.newName).toBe("src/model.py");
    expect(file.changeType).toBe("modified");
    expect(file.hunks).toHaveLength(1);

    const lines = file.hunks[0].lines;
    // hunk-header, context, remove, add, context
    expect(lines[0].type).toBe("hunk-header");
    expect(lines[1].type).toBe("context");
    expect(lines[2].type).toBe("remove");
    expect(lines[2].content).toContain("0.1");
    expect(lines[2].oldNum).toBe(25);
    expect(lines[2].newNum).toBeNull();
    expect(lines[3].type).toBe("add");
    expect(lines[3].content).toContain("0.25");
    expect(lines[3].oldNum).toBeNull();
    expect(lines[3].newNum).toBe(25);
    expect(lines[4].type).toBe("context");
  });

  it("parses a multi-file diff", () => {
    const files = parseDiff(MULTI_FILE_DIFF);
    expect(files).toHaveLength(2);
    expect(files[0].newName).toBe("src/model.py");
    expect(files[1].newName).toBe("src/train.py");

    // Second file has an addition
    const lines = files[1].hunks[0].lines;
    const addLines = lines.filter((l) => l.type === "add");
    expect(addLines).toHaveLength(1);
    expect(addLines[0].content).toContain("model.compile()");
  });

  it("detects new file change type", () => {
    const files = parseDiff(NEW_FILE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].changeType).toBe("added");
    expect(files[0].newName).toBe("src/utils.py");
  });

  it("detects deleted file change type", () => {
    const files = parseDiff(DELETED_FILE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].changeType).toBe("deleted");
  });

  it("detects renamed file change type", () => {
    const files = parseDiff(RENAMED_FILE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].changeType).toBe("renamed");
    expect(files[0].oldName).toBe("old_name.py");
    expect(files[0].newName).toBe("new_name.py");
  });

  it("tracks line numbers correctly through a hunk", () => {
    const files = parseDiff(SINGLE_FILE_DIFF);
    const lines = files[0].hunks[0].lines.filter(
      (l) => l.type !== "hunk-header",
    );

    // Context line: old=24, new=24
    expect(lines[0].oldNum).toBe(24);
    expect(lines[0].newNum).toBe(24);

    // Remove line: old=25, new=null
    expect(lines[1].oldNum).toBe(25);
    expect(lines[1].newNum).toBeNull();

    // Add line: old=null, new=25
    expect(lines[2].oldNum).toBeNull();
    expect(lines[2].newNum).toBe(25);

    // Context line: old=26, new=26
    expect(lines[3].oldNum).toBe(26);
    expect(lines[3].newNum).toBe(26);
  });

  it("handles binary file diff (no hunks)", () => {
    const diff = `diff --git a/image.png b/image.png
new file mode 100644
Binary files /dev/null and b/image.png differ`;
    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].hunks).toHaveLength(0);
  });

  it("handles mode change only", () => {
    const diff = `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755`;
    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].changeType).toBe("modified");
    expect(files[0].hunks).toHaveLength(0);
  });

  it("handles file with spaces in path", () => {
    const diff = `diff --git a/my file.ts b/my file.ts
--- a/my file.ts
+++ b/my file.ts
@@ -1,1 +1,1 @@
-old
+new`;
    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].newName).toBe("my file.ts");
  });

  it("handles multiple hunks in a single file", () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 context
-old1
+new1
 context
@@ -10,3 +10,3 @@
 context
-old2
+new2
 context`;
    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].hunks).toHaveLength(2);
  });
});
