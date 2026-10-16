import type { SessionTreeItem } from "@pimate/protocol";
import { expect, it } from "vitest";
import { treeKind, treeRows } from "../src/lib/treeRows";

function node(
	id: string,
	parentId: string | null,
	kind = "user",
	extra: Partial<SessionTreeItem> = {},
): SessionTreeItem {
	return { id, parentId, kind, preview: id, onBranch: false, isCurrent: false, isLeaf: false, ...extra };
}
const nodes = [
	node("u", null),
	node("a", "u", "assistant"),
	node("left", "a", "user", { label: "branch" }),
	node("answer", "left", "assistant", { isCurrent: true, onBranch: true }),
	node("right", "a"),
];

it("indents forks but not every message in a linear conversation", () => {
	const rows = treeRows(nodes, false);
	expect(rows.map((r) => [r.id, r.depth, r.parentId])).toEqual([
		["u", 0, null],
		["a", 0, "u"],
		["left", 1, "a"],
		["answer", 1, "left"],
		["right", 1, "a"],
	]);
	expect(rows[3]).toMatchObject({ isCurrent: true, onBranch: true });
});

it("user-only folds assistant ancestors and retains the current branch marker and labels without mutating input", () => {
	const original = structuredClone(nodes);
	const rows = treeRows(nodes, true);
	expect(rows.map((r) => [r.id, r.depth, r.parentId])).toEqual([
		["u", 0, null],
		["left", 1, "u"],
		["right", 1, "u"],
	]);
	expect(rows[1]).toMatchObject({ label: "branch", isCurrent: true, isLeaf: true });
	expect(nodes).toEqual(original);
});

it("accepts empty, missing parents and a hidden current root", () => {
	expect(treeRows([], true)).toEqual([]);
	expect(treeRows([node("hidden", null, "assistant", { isCurrent: true })], true)).toEqual([]);
	expect(treeRows([node("orphan", "missing")], false)[0]).toMatchObject({ depth: 0, parentId: null });
	expect(treeKind("user")).toBe("あなた");
	expect(treeKind("branch_summary")).toBe("枝の要約");
	expect(treeKind("extension_kind")).toBe("extension_kind");
});
