import { appendFile, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classify, normalizeStatus, normalizeTool, state } from "../src/extension/subagents/normalize.ts";
import { exampleTranscript, TRANSCRIPT_LIMIT, tailTranscript } from "../src/extension/subagents/transcript.ts";

// Shapes captured with Pi 1.2.0 / pi-subagents 0.78.0 (docs/poc-report.md and M4 scout).
const example = {
	mode: "single",
	agentScope: "both",
	projectAgentsDir: null,
	results: [
		{
			agent: "scout",
			agentSource: "user",
			task: "Inspect",
			exitCode: 0,
			messages: [
				{ role: "user", content: "Inspect" },
				{ role: "assistant", content: [{ type: "text", text: "Done" }] },
			],
		},
	],
};
const status = {
	lifecycleArtifactVersion: 3,
	runId: "async-id",
	mode: "parallel",
	state: "running",
	currentStep: 0,
	chainStepCount: 2,
	totalTokens: { input: 10, output: 20, total: 30 },
	totalCost: { costUsd: 0.2 },
	steps: [
		{
			childId: "opaque-child",
			agent: "scout",
			sessionName: "scout: Inspect code",
			status: "running",
			transcriptPath: "/trusted/transcript.jsonl",
			tokens: { input: 10, output: 20, total: 30 },
			currentTool: "bash",
			currentToolArgs: "pwd",
			totalCost: { costUsd: 0.2 },
		},
	],
};
const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
describe("subagent normalization", () => {
	it("discriminates per-call details instead of tool names or backend presence", () => {
		expect(classify(example)).toBe("example");
		expect(classify({ runId: "id", results: [{ transcriptPath: "/a" }] })).toBe("pi-subagents");
		expect(classify({ mode: "single", results: [{ agent: "scout" }] })).toBeUndefined();
	});
	it("waits for official single tool end despite initial exitCode zero; pending parallel is queued", () => {
		expect(normalizeTool(example, "call", true)).toMatchObject({
			state: "running",
			actions: ["abort_parent"],
			children: [{ state: "running" }],
		});
		expect(normalizeTool(example, "call", false)).toMatchObject({
			state: "complete",
			actions: [],
			children: [{ state: "complete" }],
		});
		expect(
			normalizeTool({ ...example, results: [{ ...example.results[0], exitCode: -1 }] }, "call", true)?.children[0]
				?.state,
		).toBe("queued");
		expect(
			normalizeTool({ ...example, results: [{ ...example.results[0], stopReason: "error" }] }, "call", false)?.state,
		).toBe("failed");
	});
	it("maps waiting and terminal states; does not count run totals twice", () => {
		expect(state("running", "supervisor_request")).toBe("waiting");
		expect(state("complete", "needs_attention")).toBe("complete");
		expect(state("partial")).toBe("failed");
		expect(normalizeStatus({ ...status, mode: "chain" }).stage).toEqual({ index: 0, count: 2 });
		expect(normalizeStatus(status)).toMatchObject({
			background: true,
			usage: { total: 30, costUsd: 0.2 },
			actions: ["interrupt", "stop"],
			children: [
				{
					id: "opaque-child",
					title: "Inspect code",
					activity: { tool: "bash", args: "pwd" },
					actions: ["steer", "follow_up", "stop_child"],
				},
			],
		});
	});
	it("gates controls by backend, run state, child identity, transcript and resumability", () => {
		expect(
			normalizeStatus({ ...status, state: "paused", steps: [{ ...status.steps[0], status: "paused" }] }),
		).toMatchObject({ actions: [], children: [{ actions: ["resume"] }] });
		expect(
			normalizeStatus({ ...status, state: "stopped", steps: [{ ...status.steps[0], status: "stopped" }] }).children[0]
				?.actions,
		).toEqual([]);
		expect(
			normalizeStatus({
				...status,
				state: "stopped",
				steps: [{ ...status.steps[0], status: "stopped", resumable: true }],
			}).children[0]?.actions,
		).toEqual(["resume"]);
		expect(
			normalizeStatus({ ...status, steps: [{ ...status.steps[0], childId: undefined }] }).children[0]?.actions,
		).toEqual(["steer", "follow_up"]);
		expect(
			normalizeTool(
				{ mode: "single", runId: "fg", results: [{ agent: "scout", transcriptPath: "/trusted" }] },
				"call",
				true,
			)?.actions,
		).toEqual(["interrupt"]);
	});
});
const line = (message: unknown, extra = {}) =>
	`${JSON.stringify({ version: 1, recordType: "message", message, ...extra })}\n`;
it("tails complete JSON lines with opaque byte cursors, task separation, truncation and replacement", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pimate-transcript-"));
	dirs.push(dir);
	const path = join(dir, "transcript.jsonl");
	const assistant = line({ role: "assistant", content: [{ type: "text", text: "答え" }] });
	await writeFile(
		path,
		line({ role: "user", content: "task" }, { sourceEventType: "initial_prompt", text: "task" }) +
			line({ role: "system", content: "private system" }) +
			line({ role: "user", content: "task" }) +
			assistant.slice(0, -2),
	);
	const first = await tailTranscript(path);
	expect(first).toMatchObject({ task: "task", items: [] });
	expect(first.cursor).not.toContain(path);
	await appendFile(path, assistant.slice(-2));
	const second = await tailTranscript(path, first.cursor, first.task);
	expect(second.items).toEqual([expect.objectContaining({ kind: "assistant", text: "答え" })]);
	expect((await tailTranscript(path, second.cursor)).items).toEqual([]);
	await writeFile(path, assistant);
	expect((await tailTranscript(path, second.cursor)).items).toHaveLength(1);
	await writeFile(join(dir, "replacement"), assistant);
	await rename(join(dir, "replacement"), path);
	expect((await tailTranscript(path, second.cursor)).items).toHaveLength(1);
});
it("bounds large records and continues beyond them", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pimate-transcript-"));
	dirs.push(dir);
	const path = join(dir, "transcript.jsonl");
	await writeFile(
		path,
		line({ role: "system", content: "x".repeat(TRANSCRIPT_LIMIT + 10) }) +
			line({ role: "assistant", content: [{ type: "text", text: "after" }] }),
	);
	const first = await tailTranscript(path);
	expect(first.truncated).toBe(true);
	const second = await tailTranscript(path, first.cursor);
	expect(second.items).toEqual([expect.objectContaining({ text: "after" })]);
	expect(Buffer.byteLength(JSON.stringify(second))).toBeLessThanOrEqual(TRANSCRIPT_LIMIT);
});
it("official messages use count cursor and omit system and duplicate task", () => {
	const first = exampleTranscript(example.results[0].messages, "Inspect");
	expect(first.items).toEqual([expect.objectContaining({ kind: "assistant", text: "Done" })]);
	expect(exampleTranscript(example.results[0].messages, "Inspect", first.cursor).items).toEqual([]);
});

it("registry learns async-started id, watches atomic status replacements, gates actions and retains resume links", async () => {
	const { SubagentRegistry } = await import("../src/extension/subagents/registry.ts");
	const dir = await mkdtemp(join(tmpdir(), "pimate-registry-"));
	dirs.push(dir);
	const path = join(dir, "status.json");
	await writeFile(path, JSON.stringify(status));
	const listeners = new Map<string, (value: unknown) => void>();
	const calls: { method: string; params: Record<string, unknown> }[] = [];
	const events: unknown[] = [];
	let writes = 0;
	const hub = {
		session: { id: "parent", file: "/parent" },
		writeMeta: () => {
			writes++;
		},
		emit: (event: unknown) => events.push(event),
		pi: {
			appendEntry: () => {},
			events: {
				on: (name: string, fn: (v: unknown) => void) => {
					listeners.set(name, fn);
					return () => listeners.delete(name);
				},
				emit: (_name: string, request: { requestId: string; method: string; params: Record<string, unknown> }) => {
					calls.push(request);
					queueMicrotask(() =>
						listeners.get(`subagents:rpc:v1:reply:${request.requestId}`)?.({
							success: true,
							data: request.method === "resume" ? { details: { asyncId: "resumed-id" } } : {},
						}),
					);
				},
			},
		},
	};
	const registry = new SubagentRegistry(hub as unknown as import("../src/extension/hub.ts").Hub);
	const wait = async (accept: () => boolean) => {
		const end = Date.now() + 2000;
		while (!accept()) {
			if (Date.now() > end) throw Error("Registry did not update");
			await new Promise((r) => setTimeout(r, 10));
		}
	};
	try {
		registry.bus("subagent:async-started", { id: status.runId, asyncDir: dir, sessionId: "other" });
		expect(registry.snapshot().runs).toEqual([]);
		registry.bus("subagent:async-started", { id: status.runId, asyncDir: dir, sessionId: "parent" });
		await wait(() => registry.snapshot().runs[0]?.children.length === 1);
		expect(registry.snapshot().runs[0]?.mode).toBe("parallel");
		await expect(
			registry.control({ runId: status.runId, action: "resume", childId: "opaque-child", text: "go" }),
		).rejects.toMatchObject({ code: "unsupported" });
		await registry.control({ runId: status.runId, action: "stop_child", childId: "opaque-child" });
		expect(calls.find((r) => r.method === "stop")?.params).toEqual({ runId: status.runId, childId: "opaque-child" });
		expect(registry.snapshot().runs[0]?.children[0]?.state).toBe("stopping");
		await writeFile(
			join(dir, "next"),
			JSON.stringify({ ...status, state: "paused", steps: [{ ...status.steps[0], status: "paused" }] }),
		);
		await rename(join(dir, "next"), path);
		await wait(() => registry.snapshot().runs[0]?.state === "paused");
		expect(
			await registry.control({ runId: status.runId, action: "resume", childId: "opaque-child", text: "continue" }),
		).toMatchObject({ newRunId: "resumed-id" });
		expect(registry.snapshot().runs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: status.runId, resumedAs: "resumed-id" }),
				expect.objectContaining({ id: "resumed-id", resumedFrom: status.runId }),
			]),
		);
		expect(writes).toBeGreaterThan(1);
		expect(events.length).toBeGreaterThan(0);
	} finally {
		registry.dispose();
	}
});

it("folds workflow references, routes child controls/transcripts and restores the projected branch", async () => {
	const { countSubagents } = await import("@pimate/protocol");
	const { SubagentRegistry } = await import("../src/extension/subagents/registry.ts");
	const listeners = new Map<string, (value: unknown) => void>();
	const calls: { method: string; params: Record<string, unknown> }[] = [];
	const branch: unknown[] = [];
	const events: { type: string; run?: { id: string } }[] = [];
	const hub = {
		session: { id: "parent" },
		writeMeta() {},
		emit: (e: { type: string }) => events.push(e),
		pi: {
			appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", customType, data }),
			events: {
				on: (name: string, fn: (v: unknown) => void) => {
					listeners.set(name, fn);
					return () => listeners.delete(name);
				},
				emit: (_name: string, request: { requestId: string; method: string; params: Record<string, unknown> }) => {
					calls.push(request);
					queueMicrotask(() =>
						listeners.get(`subagents:rpc:v1:reply:${request.requestId}`)?.({
							success: true,
							data: request.method === "resume" ? { details: { asyncId: "revived" } } : {},
						}),
					);
				},
			},
		},
	};
	const registry = new SubagentRegistry(hub as unknown as import("../src/extension/hub.ts").Hub);
	const wait = async (accept: () => boolean) => {
		const end = Date.now() + 2000;
		while (!accept()) {
			if (Date.now() > end) throw Error("Registry did not fold");
			await new Promise((r) => setTimeout(r, 10));
		}
	};
	const artifact = async (value: unknown) => {
		const dir = await mkdtemp(join(tmpdir(), "pimate-fold-"));
		dirs.push(dir);
		await writeFile(join(dir, "status.json"), JSON.stringify(value));
		return dir;
	};
	const childDir = await artifact({
		...status,
		runId: "nested",
		mode: "single",
		totalTokens: { total: 30 },
		steps: [{ ...status.steps[0], childId: "actual-child" }],
	});
	const transcript = join(childDir, "transcript.jsonl");
	await writeFile(transcript, line({ role: "assistant", content: "nested answer" }));
	const childStatus = {
		...status,
		runId: "nested",
		mode: "single",
		steps: [{ ...status.steps[0], childId: "actual-child", transcriptPath: transcript, model: "test/model" }],
	};
	await writeFile(join(childDir, "status.json"), JSON.stringify(childStatus));
	const workflow = {
		runId: "workflow",
		mode: "workflow",
		state: "running",
		workflow: { resource: { name: "tasks", invocation: "named" } },
		totalTokens: { total: 999 },
		steps: [
			{ agent: "unused", status: "complete", tokens: { input: 0, output: 0, total: 0 } },
			{ agent: "scout", runId: "nested", status: "running" },
		],
	};
	const parentDir = await artifact(workflow);
	try {
		registry.bus("subagent:async-started", { id: "nested", asyncDir: childDir });
		await wait(() => registry.snapshot().runs.some((r) => r.id === "nested" && r.children.length === 1));
		registry.bus("subagent:async-started", { id: "workflow", asyncDir: parentDir });
		await wait(() => registry.snapshot().runs.length === 1 && registry.snapshot().runs[0]?.mode === "parallel");
		const parent = registry.snapshot().runs[0]!;
		expect(parent.children[1]).toMatchObject({
			id: "step:1",
			index: 1,
			state: "running",
			model: "test/model",
			hasTranscript: true,
			actions: ["steer", "follow_up", "stop_child"],
		});
		expect(countSubagents(registry.snapshot().runs).active).toBe(1);
		expect(parent.usage?.total).toBe(30);
		expect(events.some((e) => e.type === "subagents_reset")).toBe(true);
		expect((await registry.transcript({ runId: "workflow", childId: "step:1" })).items[0]).toMatchObject({
			text: "nested answer",
		});
		for (const action of ["steer", "follow_up"] as const)
			await registry.control({ runId: "workflow", childId: "step:1", action, text: "hi" });
		expect(calls.filter((c) => c.method === "steer").map((c) => c.params)).toEqual([
			{ runId: "nested", index: 0, message: "hi", mode: "steer" },
			{ runId: "nested", index: 0, message: "hi", mode: "follow_up" },
		]);
		await registry.control({ runId: "workflow", childId: "step:1", action: "stop_child" });
		expect(calls.at(-1)).toMatchObject({ method: "stop", params: { runId: "nested" } });
		expect(calls.at(-1)?.params).not.toHaveProperty("childId");
		expect(registry.snapshot().runs[0]?.children[1]?.state).toBe("stopping");
		await registry.control({ runId: "workflow", action: "interrupt" });
		expect(calls.at(-1)).toMatchObject({ method: "interrupt", params: { runId: "workflow" } });
		await writeFile(
			join(childDir, "next"),
			JSON.stringify({ ...childStatus, state: "paused", steps: [{ ...childStatus.steps[0], status: "paused" }] }),
		);
		await rename(join(childDir, "next"), join(childDir, "status.json"));
		await wait(() => registry.snapshot().runs[0]?.children[1]?.state === "paused");
		await registry.control({ runId: "workflow", childId: "step:1", action: "resume", text: "again" });
		expect(calls.find((c) => c.method === "resume")).toMatchObject({
			params: { runId: "nested", index: 0, message: "again" },
		});
		await writeFile(
			join(parentDir, "next"),
			JSON.stringify({ ...workflow, workflow: { resource: { name: "custom-workflow", invocation: "named" } } }),
		);
		await rename(join(parentDir, "next"), join(parentDir, "status.json"));
		await wait(() => registry.snapshot().runs.find((r) => r.id === "workflow")?.mode === "workflow");
		registry.dispose();
		const restored = new SubagentRegistry(hub as unknown as import("../src/extension/hub.ts").Hub);
		try {
			await restored.start(branch);
			await wait(() => restored.snapshot().runs.find((r) => r.id === "workflow")?.children[1]?.hasTranscript === true);
			expect(restored.snapshot().runs.map((r) => r.id)).not.toContain("nested");
		} finally {
			restored.dispose();
		}
	} finally {
		registry.dispose();
	}
});

it("plain custom entries are absent from model context and default tree rendering, and preserve branches/forks", async () => {
	const { SessionManager, TreeSelectorComponent, InteractiveMode, initTheme } = await import(
		"@earendil-works/pi-coding-agent"
	);
	initTheme("dark");
	const manager = SessionManager.inMemory();
	const first = manager.appendMessage({ role: "user", content: "before launch", timestamp: 1 });
	const custom = manager.appendCustomEntry("pimate_subagent", {
		runId: "private-state",
		asyncDir: "/private/artifacts",
	});
	const second = manager.appendMessage({ role: "user", content: "after launch", timestamp: 2 });
	expect(JSON.stringify(manager.buildSessionContext())).not.toContain("private-state");
	// Exercise Pi's actual transcript append path without starting a terminal or agent.
	let rendered = false;
	const renderEntry = Reflect.get(InteractiveMode.prototype, "addCustomEntryToChat") as (
		this: unknown,
		entry: unknown,
	) => void;
	renderEntry.call(
		{
			session: { extensionRunner: { getEntryRenderer: () => undefined } },
			chatContainer: {
				addChild: () => {
					rendered = true;
				},
			},
		},
		manager.getEntry(custom),
	);
	expect(rendered).toBe(false);
	const selector = new TreeSelectorComponent(
		manager.getTree(),
		manager.getLeafId(),
		30,
		() => {},
		() => {},
	);
	expect(selector.render(100).join("\n")).not.toContain("pimate_subagent");
	manager.branch(first);
	expect(manager.getBranch().map((e) => e.id)).not.toContain(custom);
	manager.branch(second);
	expect(manager.getBranch().map((e) => e.id)).toContain(custom);
	manager.createBranchedSession(second);
	expect(manager.getBranch().map((e) => e.id)).toContain(custom);
	expect(JSON.stringify(manager.buildSessionContext())).not.toContain("private-state");
});
