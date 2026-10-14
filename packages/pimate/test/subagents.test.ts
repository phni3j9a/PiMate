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
