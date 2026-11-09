import assert from "node:assert/strict";
import { it } from "node:test";

import { isOsJunk, keepBothName, pastedName, resolveDropTarget, splitSameName } from "../../src/lib/files/drop-target";

// Report §19.2: every row of the table.
it("folder rows, empty space and other-type files upload into a folder", () => {
  assert.deepEqual(resolveDropTarget({ kind: "folder", id: "f", path: "/design" }, [{ name: "a.png" }]), { kind: "folder", folderId: "f", path: "/design", hint: "Upload to /design" });
  assert.equal(resolveDropTarget({ kind: "empty", folderId: "g", path: "/design/icons" }, [{ name: "a" }]).hint, "Upload to /design/icons");
  assert.equal(resolveDropTarget({ kind: "file", id: "n", name: "logo.svg", parentId: "f", parentPath: "/design", version: 3 }, [{ name: "logo.png" }]).hint, "Upload to /design");
});

it("one same-type file on a file row or an open file is a new version", () => {
  assert.deepEqual(resolveDropTarget({ kind: "file", id: "n", name: "logo.svg", parentId: "f", parentPath: "/design", version: 3 }, [{ name: "logo-new.SVG" }]), { kind: "version", nodeId: "n", name: "logo.svg", hint: "New version of logo.svg · v3 → v4" });
  assert.equal(resolveDropTarget({ kind: "open-file", id: "n", name: "a.md", version: 1 }, [{ name: "b.md" }]).hint, "New version · v1 → v2");
  assert.equal(resolveDropTarget({ kind: "open-file", id: "n", name: "a.md", version: 1 }, [{ name: "b.md" }, { name: "c.md" }]).kind, "refused");
});

it("task panel: bands give the role, anywhere else is a draft; refusals say why", () => {
  assert.deepEqual(resolveDropTarget({ kind: "task", taskNumber: 4 }, [{ name: "a" }]), { kind: "task", role: "working", hint: "Add to #4 as draft" });
  assert.equal(resolveDropTarget({ kind: "task", taskNumber: 4, role: "deliverable" }, [{ name: "a" }]).hint, "Add to #4 as final");
  assert.equal(resolveDropTarget({ kind: "task-file", id: "n", name: "plan.pdf", taskNumber: 4, version: 2 }, [{ name: "plan.pdf" }]).hint, "New version of plan.pdf");
  assert.equal(resolveDropTarget({ kind: "nowhere", label: "Trash" }, []).hint, "Can't drop on Trash");
  assert.equal(resolveDropTarget({ kind: "folder", id: "f", path: "/x", readOnly: true }, []).hint, "Read only");
  assert.equal(resolveDropTarget({ kind: "file", id: "n", name: "a", parentId: null, parentPath: "/", version: 1, lockedBy: "Sam" }, [{ name: "a" }]).hint, "Locked by Sam");
  assert.equal(resolveDropTarget({ kind: "task", taskNumber: 4, handedIn: true }, []).hint, "Handed in");
});

it("same names become versions; keep both picks the next free name; OS junk and pasted names", () => {
  const { versions, fresh } = splitSameName([{ name: "Logo.svg" }, { name: "new.png" }, { name: "b.md", webkitRelativePath: "docs/b.md" }], { "logo.svg": "n1", "docs/b.md": "n2" });
  assert.deepEqual(versions.map((v) => v.nodeId), ["n1", "n2"]);
  assert.deepEqual(fresh.map((f) => f.name), ["new.png"]);
  assert.equal(keepBothName("logo.svg", new Set(["logo.svg", "Logo (2).svg"])), "logo (3).svg");
  assert.equal(keepBothName("README", new Set()), "README (2)");
  assert.ok(isOsJunk(".DS_Store") && !isOsJunk(".env"));
  assert.equal(pastedName("image/jpeg", new Date(2026, 10, 9, 14, 32)), "Pasted image 2026-11-09 14.32.jpg");
});
