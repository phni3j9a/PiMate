import type {
	ExtensionCommandContext,
	ExtensionContext,
	SessionEntry,
	SessionTreeNode,
} from "@earendil-works/pi-coding-agent";
import type { SessionTree, SessionTreeItem } from "@pimate/protocol";
import { RcError } from "./dispatch.ts";

export const MAX_TREE_NODES = 1000;
export const MAX_TREE_PREVIEW = 160;
// shortcut: scan at most 10,000 entries per read; add pagination if full very large trees are needed.
const MAX_SCANNED_NODES = 10000;

function text(content: unknown): string {
	return typeof content === "string"
		? content
		: Array.isArray(content)
			? content
					.filter((b) => b?.type === "text")
					.map((b) => b.text ?? "")
					.join("")
			: "";
}

function body(entry: SessionEntry): { kind: string; text: string } | null {
	if (entry.type === "message") {
		if (entry.message.role === "toolResult") return null;
		return { kind: entry.message.role, text: "content" in entry.message ? text(entry.message.content) : "" };
	}
	if (entry.type === "compaction" || entry.type === "branch_summary") return { kind: entry.type, text: entry.summary };
	if (entry.type === "custom_message") return { kind: entry.type, text: text(entry.content) };
	return null;
}

/** Hidden entries are folded into their closest visible ancestor; no tool output or image data is sent. */
export function normalizeTree(
	manager: Pick<ExtensionContext["sessionManager"], "getTree" | "getBranch" | "getLeafId">,
): SessionTree {
	const entries = manager.getBranch();
	const branch = new Set(entries.map((e) => e.id));
	const visibleBranch = entries.filter((e) => body(e));
	// Keep the current end of an over-budget linear conversation, folding its oldest ancestors.
	const skipped = new Set(
		visibleBranch.length > MAX_TREE_NODES
			? visibleBranch.slice(0, -Math.floor(MAX_TREE_NODES / 2)).map((e) => e.id)
			: [],
	);
	const leafId = manager.getLeafId();
	const nodes: SessionTreeItem[] = [];
	const stack: { node: SessionTreeNode; parentId: string | null }[] = [];
	const push = (children: SessionTreeNode[], parentId: string | null) => {
		// The active branch gets the budget first, so a large abandoned branch cannot hide the current position.
		const sorted = children.toSorted((a, b) => Number(branch.has(b.entry.id)) - Number(branch.has(a.entry.id)));
		for (let i = sorted.length - 1; i >= 0; i--) stack.push({ node: sorted[i], parentId });
	};
	push(manager.getTree(), null);
	let scanned = 0;
	let current: SessionTreeItem | undefined;
	while (stack.length && nodes.length < MAX_TREE_NODES && scanned < MAX_SCANNED_NODES) {
		const { node, parentId } = stack.pop()!;
		scanned++;
		const e = node.entry;
		const content = body(e);
		let visibleParent = parentId;
		if ((content || node.label) && !skipped.has(e.id)) {
			const preview = (content?.text ?? "").replace(/\s+/g, " ").trim();
			const item: SessionTreeItem = {
				id: e.id,
				parentId,
				kind: content?.kind ?? e.type,
				preview: preview.length > MAX_TREE_PREVIEW ? `${preview.slice(0, MAX_TREE_PREVIEW - 1)}…` : preview,
				label: node.label?.slice(0, 200),
				timestamp: Date.parse(e.timestamp) || undefined,
				onBranch: branch.has(e.id),
				isCurrent: false,
				isLeaf: true,
			};
			nodes.push(item);
			visibleParent = e.id;
			if (item.onBranch) current = item;
		}
		push(node.children, visibleParent);
	}
	if (current) current.isCurrent = true;
	const parents = new Set(nodes.map((n) => n.parentId));
	for (const node of nodes) node.isLeaf = !parents.has(node.id);
	return { nodes, leafId, truncated: stack.length > 0 || skipped.size > 0 };
}

/** Pi's command context drops editorText; reproduce AgentSession.navigateTree's text selection. */
export async function navigateTree(ctx: ExtensionCommandContext, targetId: string, summarize = false) {
	if (!ctx.isIdle()) throw new RcError("busy");
	const entry = ctx.sessionManager.getEntry(targetId);
	if (!entry) throw new RcError("not_found", "移動先が見つかりません");
	const editorText =
		targetId === ctx.sessionManager.getLeafId()
			? undefined
			: entry.type === "message" && entry.message.role === "user"
				? text(entry.message.content)
				: entry.type === "custom_message"
					? text(entry.content)
					: undefined;
	const result = await ctx.navigateTree(targetId, { summarize });
	return { cancelled: result.cancelled, ...(!result.cancelled && editorText !== undefined ? { editorText } : {}) };
}
