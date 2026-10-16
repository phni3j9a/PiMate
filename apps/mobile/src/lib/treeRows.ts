import type { SessionTreeItem } from "@pimate/protocol";

export interface TreeRow extends SessionTreeItem {
	depth: number;
}

/** RC sends preorder. Filtering folds hidden ancestors, while only forks add indentation. */
export function treeRows(nodes: readonly SessionTreeItem[], usersOnly: boolean): TreeRow[] {
	const rows: TreeRow[] = [];
	const visible = new Map<string, TreeRow | null>();
	for (const node of nodes) {
		const parent = node.parentId ? (visible.get(node.parentId) ?? null) : null;
		if (usersOnly && node.kind !== "user") {
			visible.set(node.id, parent);
			if (node.isCurrent && parent) parent.isCurrent = true;
			continue;
		}
		const row = { ...node, parentId: parent?.id ?? null, depth: 0 };
		rows.push(row);
		visible.set(node.id, row);
	}
	const childCounts = new Map<string, number>();
	for (const row of rows) if (row.parentId) childCounts.set(row.parentId, (childCounts.get(row.parentId) ?? 0) + 1);
	for (const row of rows) {
		row.isLeaf = !childCounts.has(row.id);
		const parent = row.parentId ? visible.get(row.parentId) : null;
		if (parent) row.depth = parent.depth + ((childCounts.get(parent.id) ?? 0) > 1 ? 1 : 0);
	}
	return rows;
}

export function treeKind(kind: string): string {
	return (
		(
			{
				user: "あなた",
				assistant: "Pi",
				compaction: "圧縮",
				branch_summary: "枝の要約",
				custom_message: "拡張メッセージ",
			} as Record<string, string>
		)[kind] ?? kind
	);
}
