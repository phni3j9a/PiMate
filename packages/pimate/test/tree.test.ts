import type { ExtensionCommandContext, ExtensionContext, SessionTreeNode } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { dispatch, type Handlers, validateRequest } from "../src/extension/dispatch.ts";
import { createHandlers } from "../src/extension/handlers.ts";
import type { Hub } from "../src/extension/hub.ts";
import { MAX_TREE_NODES, MAX_TREE_PREVIEW, navigateTree, normalizeTree } from "../src/extension/tree.ts";

const stamp = "2026-01-01T00:00:00.000Z";
function node(
	id: string,
	parentId: string | null,
	role = "user",
	content: unknown = id,
	children: SessionTreeNode[] = [],
): SessionTreeNode {
	return {
		entry: { type: "message", id, parentId, timestamp: stamp, message: { role, content } },
		children,
	} as SessionTreeNode;
}
function manager(tree: SessionTreeNode[], branch: string[], leafId: string | null = branch.at(-1) ?? null) {
	return {
		getTree: () => tree,
		getBranch: () => branch.map((id) => ({ id })),
		getLeafId: () => leafId,
	} as ExtensionContext["sessionManager"];
}

it("folds tools/state, keeps summaries/labels, bounds previews, and locates the current leaf's visible ancestor", () => {
	const summary = {
		entry: {
			type: "branch_summary",
			id: "summary",
			parentId: "tool",
			timestamp: stamp,
			summary: "branch summary",
			fromId: "old",
		},
		children: [],
	} as SessionTreeNode;
	const compaction = {
		entry: {
			type: "compaction",
			id: "compact",
			parentId: null,
			timestamp: stamp,
			summary: "compressed",
			firstKeptEntryId: "u",
			tokensBefore: 100,
		},
		children: [],
	} as SessionTreeNode;
	const state = {
		entry: { type: "model_change", id: "state", parentId: "a", timestamp: stamp },
		children: [],
	} as unknown as SessionTreeNode;
	const tree = [
		node(
			"u",
			null,
			"user",
			[
				{ type: "text", text: "hello\n world" },
				{ type: "image", data: "DO NOT SEND" },
			],
			[node("a", "u", "assistant", "x".repeat(500), [node("tool", "a", "toolResult", "SECRET", [summary]), state])],
		),
		compaction,
	];
	tree[0].label = "bookmark";
	const result = normalizeTree(manager(tree, ["u", "a", "state"]));
	expect(result).toMatchObject({ leafId: "state", truncated: false });
	expect(result.nodes.map((n) => [n.id, n.parentId, n.kind])).toEqual([
		["u", null, "user"],
		["a", "u", "assistant"],
		["summary", "a", "branch_summary"],
		["compact", null, "compaction"],
	]);
	expect(result.nodes[0]).toMatchObject({
		preview: "hello world",
		label: "bookmark",
		onBranch: true,
		isLeaf: false,
		timestamp: Date.parse(stamp),
	});
	expect(result.nodes[1]).toMatchObject({ isCurrent: true, isLeaf: false });
	expect(result.nodes[1].preview).toHaveLength(MAX_TREE_PREVIEW);
	expect(result.nodes[2]).toMatchObject({ onBranch: false, isLeaf: true });
	expect(JSON.stringify(result)).not.toMatch(/SECRET|DO NOT SEND/);
});

it("bounds a huge tree and gives the active branch priority", () => {
	const roots = Array.from({ length: MAX_TREE_NODES + 10 }, (_, i) => node(`${i}`, null));
	const result = normalizeTree(manager(roots, [`${MAX_TREE_NODES + 9}`]));
	expect(result.nodes).toHaveLength(MAX_TREE_NODES);
	expect(result.truncated).toBe(true);
	expect(result.nodes[0]).toMatchObject({ id: `${MAX_TREE_NODES + 9}`, isCurrent: true });
	expect(normalizeTree(manager([], [], null))).toEqual({ nodes: [], leafId: null, truncated: false });
});

it("bounds hidden entry scanning without recursive traversal", () => {
	let tree: SessionTreeNode[] = [];
	for (let i = 0; i < 10010; i++) tree = [node(`${i}`, null, "toolResult", "hidden", tree)];
	expect(normalizeTree(manager(tree, []))).toMatchObject({ nodes: [], truncated: true });
});

function command(
	entry: SessionTreeNode["entry"] | undefined,
	opts: { idle?: boolean; cancelled?: boolean; leafId?: string } = {},
) {
	return {
		isIdle: () => opts.idle ?? true,
		sessionManager: { getEntry: () => entry, getLeafId: () => opts.leafId ?? "old" },
		navigateTree: vi.fn(async () => ({ cancelled: opts.cancelled ?? false })),
	} as unknown as ExtensionCommandContext;
}

describe("tree navigation", () => {
	it("uses the command context and returns the full user text, never the preview or images", async () => {
		const text = "long user text ".repeat(100);
		const ctx = command(
			node("target", "parent", "user", [
				{ type: "text", text },
				{ type: "image", data: "secret" },
			]).entry,
		);
		expect(await navigateTree(ctx, "target", true)).toEqual({ cancelled: false, editorText: text });
		expect(ctx.navigateTree).toHaveBeenCalledWith("target", { summarize: true });
	});
	it("handles custom messages, assistant targets, cancellation and a no-op like Pi", async () => {
		const custom = { type: "custom_message", id: "custom", content: "custom body" } as SessionTreeNode["entry"];
		expect(await navigateTree(command(custom), "custom")).toEqual({ cancelled: false, editorText: "custom body" });
		expect(await navigateTree(command(node("a", null, "assistant").entry), "a")).toEqual({ cancelled: false });
		expect(await navigateTree(command(node("u", null).entry, { cancelled: true }), "u")).toEqual({ cancelled: true });
		expect(await navigateTree(command(node("u", null).entry, { leafId: "u" }), "u")).toEqual({ cancelled: false });
	});
	it("rejects busy, missing targets and propagates navigation errors", async () => {
		await expect(navigateTree(command(undefined, { idle: false }), "u")).rejects.toMatchObject({ code: "busy" });
		await expect(navigateTree(command(undefined), "u")).rejects.toMatchObject({ code: "not_found" });
		const ctx = command(node("u", null).entry);
		vi.mocked(ctx.navigateTree).mockRejectedValueOnce(new Error("summary failed"));
		await expect(navigateTree(ctx, "u", true)).rejects.toThrow("summary failed");
	});
});

it("reads the current tree, sets/removes labels and rejects missing entries", async () => {
	const getEntry = vi.fn((id) => (id === "u" ? node("u", null).entry : undefined));
	const setLabel = vi.fn();
	const handlers = createHandlers({
		ctx: { hasUI: true, sessionManager: { ...manager([node("u", null)], ["u"]), getEntry } },
		pi: { setLabel },
	} as unknown as Hub);
	expect(await handlers.session_tree({})).toMatchObject({ nodes: [{ id: "u", isCurrent: true }] });
	await handlers.set_label({ entryId: "u", label: " bookmark " });
	expect(setLabel).toHaveBeenLastCalledWith("u", "bookmark");
	await handlers.set_label({ entryId: "u", label: "  " });
	expect(setLabel).toHaveBeenLastCalledWith("u", undefined);
	await handlers.set_label({ entryId: "u" });
	expect(setLabel).toHaveBeenLastCalledWith("u", undefined);
	expect(() => handlers.set_label({ entryId: "missing", label: "x" })).toThrow("見つかりません");
});

it("validates tree operations and guards all tree methods with expectSessionId", async () => {
	for (const params of [{ op: "tree" }, { op: "tree", arg: "u", summarize: "yes" }])
		expect(() => validateRequest({ id: "r", method: "session_op", params })).toThrow("Invalid params");
	for (const params of [{}, { entryId: "u", label: 1 }, { entryId: "u", label: "x".repeat(201) }])
		expect(() => validateRequest({ id: "r", method: "set_label", params })).toThrow("Invalid params");
	const handlers = { session_tree: vi.fn(), set_label: vi.fn(), session_op: vi.fn() } as unknown as Handlers;
	for (const [method, params] of [
		["session_tree", {}],
		["set_label", { entryId: "u" }],
		["session_op", { op: "tree", arg: "u", summarize: false }],
	]) {
		expect(
			await dispatch(
				{ id: "r", method, params, expectSessionId: "old" },
				{ instanceId: "i", sessionId: "new" },
				handlers,
			),
		).toMatchObject({ ok: false, error: { code: "session_changed" } });
	}
	expect(handlers.session_op).not.toHaveBeenCalled();
});

it("sends tree navigation through the session command with its original session guard and blocks concurrent moves", async () => {
	const sendUserMessage = vi.fn();
	const h = {
		ctx: {
			hasUI: true,
			isIdle: () => true,
			sessionManager: { getEntry: () => node("u", null).entry, getSessionId: () => "s" },
		},
		pi: { sendUserMessage },
	} as unknown as Hub;
	const handlers = createHandlers(h);
	await handlers.session_op({ op: "tree", arg: "u", summarize: true });
	expect(sendUserMessage).toHaveBeenCalledWith(
		'/pimate-session {"op":"tree","arg":"u","summarize":true,"expectSessionId":"s"}',
		{ expandPromptTemplates: true },
	);
	expect(() => handlers.session_op({ op: "tree", arg: "u" })).toThrow("busy");
});

it("retains the current end when the active branch alone exceeds the node budget", () => {
	let tree: SessionTreeNode[] = [];
	const entries: SessionTreeNode["entry"][] = [];
	for (let i = MAX_TREE_NODES + 20; i >= 0; i--) {
		const n = node(`${i}`, i ? `${i - 1}` : null, i % 2 ? "assistant" : "user", `text ${i}`, tree);
		tree = [n];
		entries.unshift(n.entry);
	}
	const m = { getTree: () => tree, getBranch: () => entries, getLeafId: () => `${MAX_TREE_NODES + 20}` };
	const result = normalizeTree(m);
	expect(result.nodes.length).toBeLessThanOrEqual(MAX_TREE_NODES);
	expect(result.truncated).toBe(true);
	expect(result.nodes.at(-1)).toMatchObject({ id: `${MAX_TREE_NODES + 20}`, isCurrent: true });
	expect(result.nodes[0].parentId).toBeNull();
});
