import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { getHub, type Hub } from "../src/extension/hub.ts";
import extension from "../src/extension/index.ts";
import { patchUI } from "../src/extension/ui.ts";

const globalHub = globalThis as typeof globalThis & { __pimateV1Hub?: Hub };
afterEach(() => {
	delete globalHub.__pimateV1Hub;
	vi.unstubAllEnvs();
});
function setup(mobile = false, trust?: string) {
	vi.stubEnv("PIMATE_ORIGIN", mobile ? "mobile" : "pc");
	vi.stubEnv("PIMATE_TRUST", trust);
	const hooks = new Map<string, (...args: any[]) => any>();
	const pi = {
		on: (event: string, fn: (...args: any[]) => any) => {
			hooks.set(event, fn);
			return () => hooks.delete(event);
		},
		registerCommand: vi.fn(),
		events: { on: () => () => {} },
		getThinkingLevel: () => "off",
	} as unknown as ExtensionAPI;
	extension(pi);
	return { hooks, h: getHub(), pi };
}
it.each(["yes", "no"])("only consumes explicit Host-origin trust decision %s", (trust) => {
	const { hooks, h } = setup(true, trust);
	expect(hooks.get("project_trust")?.()).toEqual({ trusted: trust });
	expect(process.env.PIMATE_TRUST).toBeUndefined();
	expect(process.env.PIMATE_ORIGIN).toBeUndefined();
	expect(h.trust).toBe(trust);
});
it.each([
	[false, "yes"],
	[true, undefined],
	[true, "invalid"],
])("leaves ordinary Pi project trust unchanged (%s, %s)", (mobile, trust) => {
	const { hooks } = setup(mobile as boolean, trust as string | undefined);
	expect(hooks.has("project_trust")).toBe(false);
	expect(process.env.PIMATE_TRUST).toBeUndefined();
});
it("tracks PC-only prompts and context in snapshots/events", () => {
	const { hooks, h } = setup();
	const context = { tokens: 20, percent: 1, contextWindow: 2000 };
	h.ctx = { getContextUsage: () => context } as unknown as ExtensionContext;
	const emit = vi.spyOn(h, "emit");
	hooks.get("ui_prompt_start")?.({ kind: "custom", title: "PC confirmation" });
	expect(h.snapshot()).toMatchObject({ pcPrompt: { kind: "custom", title: "PC confirmation" }, context });
	hooks.get("ui_prompt_end")?.({ kind: "custom" });
	expect(h.snapshot().pcPrompt).toBeNull();
	hooks.get("session_compact")?.();
	hooks.get("model_select")?.({ model: { provider: "faux", id: "one" } });
	expect(emit.mock.calls.filter(([event]) => event.type === "context")).toHaveLength(2);
	h.pendingUI.set("answerable", {
		request: { requestId: "answerable", kind: "select", title: "Pick" },
		resolve: () => {},
		cancel: () => {},
	});
	hooks.get("ui_prompt_start")?.({ kind: "select", title: "Pick" });
	expect(h.snapshot().pcPrompt).toBeNull();
	hooks.get("ui_prompt_start")?.({ kind: "select", title: "Built in" });
	expect(h.snapshot().pcPrompt).toEqual({ kind: "select", title: "Built in" });
});

it.each(["agent_end", "agent_before_settle"])("keeps snapshots active while a %s handler awaits a dialog", async () => {
	const { hooks, h } = setup();
	const ctx = {
		ui: { confirm: () => new Promise<boolean>(() => {}) },
		isIdle: () => !h.agentActive,
		getContextUsage: () => undefined,
	} as unknown as ExtensionContext;
	h.ctx = ctx;
	patchUI(ctx, h);
	expect(h.snapshot().agentActive).toBe(false);
	hooks.get("agent_start")?.();
	expect(h.snapshot()).toMatchObject({ status: "running", agentActive: true });
	// Pi awaits either handler before emitting agent_settled. Use the real UI bridge during that wait.
	const extensionHandler = async () => {
		await ctx.ui.confirm("Continue?", "After the final answer");
	};
	const pending = extensionHandler();
	expect(h.snapshot()).toMatchObject({ status: "waiting_input", agentActive: true });
	const [dialog] = h.pendingUI.values();
	dialog!.resolve({ requestId: dialog!.request.requestId, confirmed: true });
	await pending;
	expect(h.snapshot().agentActive).toBe(true);
	hooks.get("agent_settled")?.({ aborted: false });
	expect(h.snapshot()).toMatchObject({ status: "idle", agentActive: false });
	// The same dialog opened outside a run has no Stop button.
	const outside = ctx.ui.confirm("Outside a run", "Nothing to stop");
	expect(h.snapshot()).toMatchObject({ status: "waiting_input", agentActive: false });
	for (const d of h.pendingUI.values()) d.cancel();
	await outside;
});

it("rebuilds branch-local subagents on session_tree, closing old watchers and clearing meta counts", async () => {
	const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { SubagentRegistry } = await import("../src/extension/subagents/registry.ts");
	const { countSubagents } = await import("@pimate/protocol");
	const dir = await mkdtemp(join(tmpdir(), "pimate-tree-"));
	const { hooks, h, pi } = setup();
	h.pi = pi;
	h.session = { id: "parent" };
	const metaCounts: number[] = [];
	vi.spyOn(h, "writeMeta").mockImplementation(() => {
		metaCounts.push(countSubagents(h.subagents?.snapshot().runs ?? []).active);
	});
	const emit = vi.spyOn(h, "emit");
	const old = new SubagentRegistry(h);
	h.subagents = old;
	try {
		await writeFile(
			join(dir, "status.json"),
			JSON.stringify({
				runId: "old-branch",
				mode: "single",
				state: "running",
				steps: [{ agent: "scout", status: "running" }],
			}),
		);
		await old.start([{ type: "custom", customType: "pimate_subagent", data: { runId: "old-branch", asyncDir: dir } }]);
		await vi.waitFor(() => expect(old.snapshot().runs[0]?.children).toHaveLength(1));
		const watcher = (Reflect.get(old, "watchers") as Map<string, import("node:fs").FSWatcher>).get("old-branch")!;
		const close = vi.spyOn(watcher, "close");
		const dispose = vi.spyOn(old, "dispose");
		const ctx = {
			hasUI: true,
			getContextUsage: () => null,
			sessionManager: { getBranch: () => [] },
		} as unknown as ExtensionContext;
		hooks.get("session_tree")?.({ oldLeafId: "after-launch", newLeafId: "before-launch" }, ctx);
		expect(emit).toHaveBeenCalledWith({ type: "session_changed", reason: "tree", session: { id: "parent" } });
		expect(dispose).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
		expect(h.subagents).not.toBe(old);
		expect(h.subagents?.snapshot().runs).toEqual([]);
		expect(metaCounts).toContain(1);
		expect(metaCounts.at(-1)).toBe(0);
		expect(emit.mock.calls).toContainEqual([{ type: "subagents_reset", state: { runs: [], backends: [] } }]);
		await expect(h.subagents!.control({ runId: "old-branch", action: "stop" })).rejects.toMatchObject({
			code: "not_found",
		});
	} finally {
		h.subagents?.dispose();
		old.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

it("tree command emits full editor text after completion, rejects delayed session changes and releases its busy flag", async () => {
	const { h, pi } = setup();
	const command = vi.mocked(pi.registerCommand).mock.calls.find(([name]) => name === "pimate-session")![1].handler;
	const ctx = {
		isIdle: () => true,
		sessionManager: {
			getSessionId: () => "s",
			getLeafId: () => "old",
			getEntry: () => ({ type: "message", message: { role: "user", content: "full editor text" } }),
		},
		navigateTree: vi.fn(async () => ({ cancelled: false })),
	} as unknown as import("@earendil-works/pi-coding-agent").ExtensionCommandContext;
	const emit = vi.spyOn(h, "emit");
	h.treeNavigating = true;
	await command('{"op":"tree","arg":"u","summarize":true,"expectSessionId":"s"}', ctx);
	expect(ctx.navigateTree).toHaveBeenCalledWith("u", { summarize: true });
	expect(emit).toHaveBeenCalledWith({
		type: "session_op_done",
		op: "tree",
		cancelled: false,
		editorText: "full editor text",
	});
	expect(h.treeNavigating).toBe(false);
	vi.mocked(ctx.navigateTree).mockClear();
	h.treeNavigating = true;
	await command('{"op":"tree","arg":"u","expectSessionId":"other"}', ctx);
	expect(ctx.navigateTree).not.toHaveBeenCalled();
	expect(emit).toHaveBeenLastCalledWith(
		expect.objectContaining({
			type: "session_op_done",
			op: "tree",
			cancelled: true,
			error: expect.stringContaining("会話が切り替わりました"),
		}),
	);
	expect(h.treeNavigating).toBe(false);
	expect(h.snapshot().sessionTree).toBe(true);
});
