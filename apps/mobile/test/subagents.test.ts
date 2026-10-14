import type {
	HostMessage,
	InstanceSnapshot,
	InstanceSummary,
	SubagentChild,
	SubagentRun,
	TranscriptItem,
} from "@pimate/protocol";
import { describe, expect, it } from "vitest";
import { createView, type InstanceView, reduceView } from "../src/lib/instanceView";
import { buildDrawerGroups, drawerSubagentText } from "../src/lib/presentation";
import type { HostRuntime } from "../src/lib/store";
import { mergeTranscript, subagentRows } from "../src/lib/subagentRows";
import {
	agentsText,
	CONTROL_FEEDBACK,
	chainSteps,
	childControls,
	childElapsed,
	childLine,
	childMark,
	childModelLabel,
	clearFinishedWatch,
	compactTokens,
	countsText,
	detailState,
	detailSubtitle,
	findChild,
	findRunByToolCall,
	normalizeRun,
	normalizeState,
	runLabel,
	runStop,
	sheetHeader,
	sheetSections,
	stateCounts,
	subagentSummary,
	toolRowInfo,
	toolRowTarget,
	upsertRun,
	watchRuns,
} from "../src/lib/subagents";
import { buildRows } from "../src/lib/transcriptRows";

it("keeps accepted control feedback short without claiming steering is already delivered", () => {
	expect(CONTROL_FEEDBACK.steer).toContain("作業の区切りで反映");
	expect(CONTROL_FEEDBACK.resume).toBe("続きの実行を開始しました。");
	for (const message of Object.values(CONTROL_FEEDBACK)) {
		expect(message.length).toBeLessThan(50);
		expect(message).not.toContain("\n");
	}
});

const MIN = 60_000;
const NOW = 1_000_000_000;

function child(patch: Partial<SubagentChild> & { id: string }): SubagentChild {
	return { index: 0, agent: "reviewer", state: "running", hasTranscript: true, actions: [], ...patch };
}

function run(patch: Partial<SubagentRun> & { id: string }): SubagentRun {
	return {
		backend: "pi-subagents",
		background: true,
		mode: "parallel",
		state: "running",
		children: [],
		actions: [],
		...patch,
	};
}

const parallel = run({
	id: "r1",
	toolCallId: "tc1",
	startedAt: NOW - 5 * MIN,
	actions: ["stop", "resume"],
	usage: { total: 48_600, costUsd: 0.39 },
	children: [
		child({
			id: "c1",
			index: 0,
			title: "正しさのレビュー",
			startedAt: NOW - 252_000,
			activity: { tool: "read", args: "src/api/client.ts" },
		}),
		child({ id: "c2", index: 1, title: "テストのレビュー", startedAt: NOW - 252_000 }),
		child({
			id: "c3",
			index: 2,
			title: "複雑さのレビュー",
			state: "complete",
			startedAt: NOW - 252_000,
			endedAt: NOW - 92_000,
		}),
	],
});

describe("normalize / upsert", () => {
	it("drops unknown actions, maps unknown states and modes", () => {
		const r = normalizeRun({
			id: "x",
			backend: "pi-subagents",
			background: false,
			mode: "swarm",
			state: "exploding",
			children: [{ id: "a", index: 0, agent: "w", state: "weird", hasTranscript: true, actions: ["steer", "dance"] }],
			actions: ["stop", "teleport"],
			extra: 1,
		});
		expect(r?.state).toBe("unknown");
		expect(r?.mode).toBe("unknown");
		expect(r?.actions).toEqual(["stop"]);
		expect(r?.children[0]?.state).toBe("unknown");
		expect(r?.children[0]?.actions).toEqual(["steer"]);
	});

	it("rejects garbage", () => {
		expect(normalizeRun(null)).toBeNull();
		expect(normalizeRun({ backend: "pi-subagents" })).toBeNull();
	});

	it("upserts by id and keeps order", () => {
		let s = normalizeState({ runs: [], backends: [{ backend: "pi-subagents", supported: true }] });
		s = upsertRun(s, run({ id: "a" }));
		s = upsertRun(s, run({ id: "b" }));
		s = upsertRun(s, run({ id: "a", state: "complete" }));
		expect(s.runs.map((r) => [r.id, r.state])).toEqual([
			["a", "complete"],
			["b", "running"],
		]);
		expect(upsertRun(s, { nope: true })).toBe(s);
	});

	it("ignores runs of unsupported backends", () => {
		const s = normalizeState({
			runs: [run({ id: "a", backend: "example" })],
			backends: [{ backend: "example", supported: false }],
		});
		expect(s.runs).toEqual([]);
		expect(upsertRun(s, run({ id: "b", backend: "example" })).runs).toEqual([]);
	});
});

describe("reducer", () => {
	const ID = "inst-1";
	const snap = (patch: Partial<InstanceSnapshot> = {}): InstanceSnapshot => ({
		protocol: 1,
		instanceId: ID,
		pid: 1,
		cwd: "/w",
		origin: "pc",
		abducoSession: null,
		startedAt: 0,
		session: { id: "s1", name: "demo" },
		status: "idle",
		model: null,
		thinking: "off",
		pendingUI: [],
		seq: 10,
		...patch,
	});
	let seq = 10;
	const ev = (event: unknown): HostMessage =>
		({ type: "event", instanceId: ID, sessionId: "s1", seq: ++seq, event }) as HostMessage;
	const ready = (s: Partial<InstanceSnapshot> = {}): InstanceView =>
		reduceView(
			createView(ID),
			{ type: "subscribed", instanceId: ID, snapshot: snap(s), history: { session: { id: "s1" }, items: [] } },
			0,
		);

	it("keeps snapshot.subagents and watches active runs", () => {
		const v = ready({ subagents: { runs: [parallel], backends: [{ backend: "pi-subagents", supported: true }] } });
		expect(v.subagents.runs).toHaveLength(1);
		expect(v.subagentWatch).toEqual(["r1"]);
	});

	it("without subagents nothing changes", () => {
		const v = ready();
		expect(v.subagents.runs).toEqual([]);
		expect(subagentSummary(v.subagents.runs, v.subagentWatch)).toBeNull();
	});

	it("applies subagent_run upserts and subagents_reset", () => {
		let v = ready();
		v = reduceView(v, ev({ type: "subagent_run", run: parallel }), 0);
		expect(v.subagents.runs[0]?.id).toBe("r1");
		v = reduceView(v, ev({ type: "subagent_run", run: { ...parallel, state: "complete", children: [] } }), 0);
		expect(v.subagents.runs).toHaveLength(1);
		expect(v.subagents.runs[0]?.state).toBe("complete");
		// finished run stays watched (summary visible) until the next prompt
		expect(v.subagentWatch).toEqual(["r1"]);
		v = reduceView(v, ev({ type: "subagents_reset", state: { runs: [], backends: [] } }), 0);
		expect(v.subagents.runs).toEqual([]);
		expect(v.subagentWatch).toEqual([]);
	});

	it("ignores unknown event types", () => {
		const v = ready();
		expect(reduceView(v, ev({ type: "subagent_teleport" }), 0).subagents).toBe(v.subagents);
	});

	it("a new user message forgets finished runs", () => {
		let v = ready();
		v = reduceView(v, ev({ type: "subagent_run", run: parallel }), 0);
		v = reduceView(v, ev({ type: "subagent_run", run: { ...parallel, state: "complete", children: [] } }), 0);
		v = reduceView(v, ev({ type: "message_end", item: { kind: "user", entryId: "u9", text: "next" } }), 0);
		expect(v.subagentWatch).toEqual([]);
	});
});

describe("summary line", () => {
	it("counts children and formats", () => {
		expect(countsText(stateCounts([parallel]))).toBe("2 実行中 · 1 完了");
		const mixed = run({
			id: "m",
			children: [
				child({ id: "a", state: "waiting" }),
				child({ id: "b", state: "paused" }),
				child({ id: "c", state: "failed" }),
				child({ id: "d", state: "queued" }),
			],
		});
		// the queued one waits behind started siblings (chain) and is not counted
		expect(countsText(stateCounts([mixed]))).toBe("1 待ち · 1 一時停止 · 1 失敗");
		const chain = run({
			id: "ch",
			mode: "chain",
			children: [child({ id: "a" }), child({ id: "b", state: "queued" }), child({ id: "c", state: "queued" })],
		});
		expect(countsText(stateCounts([chain]))).toBe("1 実行中");
		const starting = run({
			id: "q",
			children: [child({ id: "a", state: "queued" }), child({ id: "b", state: "queued" })],
		});
		expect(countsText(stateCounts([starting]))).toBe("2 実行中");
	});

	it("falls back to run state without children", () => {
		expect(countsText(stateCounts([run({ id: "x", state: "running" })]))).toBe("1 実行中");
	});

	it("shows while active, and finished watched runs until cleared", () => {
		const s = subagentSummary([parallel], []);
		expect(s?.text).toBe("2 実行中 · 1 完了");
		expect(s?.mark).toBe("running");
		expect(s?.label).toBe("サブエージェント: 2 件実行中、1 件完了。一覧を開く");
		const done = {
			...parallel,
			state: "complete" as const,
			children: parallel.children.map((c) => ({ ...c, state: "complete" as const })),
		};
		expect(subagentSummary([done], [])).toBeNull();
		expect(subagentSummary([done], ["r1"])?.text).toBe("3 完了");
		expect(subagentSummary([done], ["r1"])?.mark).toBe("done");
	});

	it("watch adds active runs and clears finished ones on prompt", () => {
		const done = run({ id: "d", state: "complete" });
		const w = watchRuns([], [parallel, done]);
		expect(w).toEqual(["r1"]);
		expect(watchRuns(w, [parallel, done])).toBe(w);
		const w2 = watchRuns(["d", "gone"], [done]);
		expect(w2).toEqual(["d"]);
		expect(clearFinishedWatch(["r1", "d"], [parallel, done])).toEqual(["r1"]);
	});
});

describe("sheet", () => {
	it("labels runs", () => {
		expect(runLabel(parallel)).toBe("並列 · バックグラウンド");
		expect(runLabel(run({ id: "s", mode: "single", background: false }))).toBe("単体");
		expect(runLabel(run({ id: "c", mode: "chain", background: false, stage: { index: 0, count: 3 } }))).toBe(
			"チェーン 1 / 3",
		);
	});

	it("gates the stop action", () => {
		expect(runStop(parallel)?.label).toBe("停止…");
		expect(runStop(run({ id: "f", background: false, actions: ["interrupt"] }))?.label).toBe("中断…");
		const ex = runStop(run({ id: "e", backend: "example", actions: ["abort_parent"] }));
		expect(ex?.label).toBe("すべて停止…");
		expect(ex?.message).toContain("親の Pi");
		expect(runStop(run({ id: "n" }))).toBeNull();
	});

	it("child lines and elapsed", () => {
		const [c1, c2, c3] = parallel.children as [SubagentChild, SubagentChild, SubagentChild];
		expect(childLine(c1, parallel)).toEqual({ text: "read  src/api/client.ts", tone: "mono" });
		expect(childLine(c2, parallel).text).toBe("作業中");
		expect(childLine(c3, parallel).text).toBe("完了");
		expect(childElapsed(c1, parallel, NOW)).toBe("4:12");
		expect(childElapsed(c3, parallel, NOW)).toBe("2:40");
		expect(childElapsed(child({ id: "z" }), run({ id: "y", children: [child({ id: "z" }), c1] }), NOW)).toBeNull();
		const failed = child({ id: "f", state: "failed", error: "npm ci が終了コード 1\nstack" });
		expect(childLine(failed, parallel)).toEqual({ text: "失敗 · npm ci が終了コード 1", tone: "failed" });
		expect(childLine(child({ id: "e", state: "failed", exitCode: 2 }), parallel).text).toBe("失敗 · 終了コード 2");
		expect(childLine(child({ id: "w", state: "waiting", question: "どちらの方式？" }), parallel)).toEqual({
			text: "待ち · どちらの方式？",
			tone: "waiting",
		});
		expect(childLine(child({ id: "w", state: "waiting" }), parallel).text).toBe("待ち · 要対応");
		expect(childLine(child({ id: "p", state: "paused" }), parallel).text).toBe("一時停止");
		const old = run({ id: "o", state: "complete", endedAt: NOW - 18 * MIN });
		expect(childLine(child({ id: "o1", state: "complete" }), old, { previous: true, now: NOW }).text).toBe(
			"完了 · 18分前",
		);
	});

	it("splits open and previous runs", () => {
		const old = run({
			id: "old",
			state: "complete",
			startedAt: NOW - 30 * MIN,
			updatedAt: NOW - 20 * MIN,
			children: [child({ id: "o", state: "complete" })],
		});
		const failed = run({
			id: "bad",
			state: "failed",
			startedAt: NOW - 40 * MIN,
			updatedAt: NOW - 25 * MIN,
			children: [child({ id: "b", state: "failed" })],
		});
		const paused = run({ id: "p", state: "paused", children: [child({ id: "pp", state: "paused" })] });
		const s = sheetSections([failed, parallel, old, paused]);
		expect(s.open.map((r) => r.id).sort()).toEqual(["p", "r1"]);
		expect(s.previous.map((p) => p.child.id)).toEqual(["o", "b"]);
	});

	it("header sums runs and omits unknown parts", () => {
		expect(compactTokens(48_600)).toBe("48.6K");
		expect(compactTokens(950)).toBe("950");
		expect(compactTokens(2_000_000)).toBe("2M");
		expect(sheetHeader([parallel])).toEqual({ tokens: "48.6K", cost: "$0.39", backend: "pi-subagents" });
		const fromChildren = run({
			id: "k",
			children: [
				child({ id: "a", usage: { input: 1000, output: 200, costUsd: 0.1 } }),
				child({ id: "b", usage: { total: 800 } }),
			],
		});
		expect(sheetHeader([fromChildren])).toEqual({ tokens: "2K", cost: "$0.10", backend: "pi-subagents" });
		expect(sheetHeader([run({ id: "e", backend: "example" })])).toEqual({
			tokens: null,
			cost: null,
			backend: "公式サンプル",
		});
	});
});

describe("chat tool row", () => {
	it("finds the run and describes it", () => {
		expect(findRunByToolCall([parallel], "tc1")).toBe(parallel);
		expect(findRunByToolCall([parallel], "other")).toBeUndefined();
		expect(toolRowInfo(parallel)).toEqual({ subject: "reviewer × 3 · 並列", meta: "2 実行中", mark: "running" });
		const chain = run({
			id: "ch",
			mode: "chain",
			children: [
				child({ id: "a", agent: "scout", index: 0 }),
				child({ id: "b", agent: "planner", index: 1, state: "queued" }),
				child({ id: "c", agent: "worker", index: 2, state: "queued" }),
			],
		});
		expect(agentsText(chain)).toBe("scout → planner → worker");
		expect(
			toolRowInfo(run({ id: "s", mode: "single", state: "failed", children: [child({ id: "x", state: "failed" })] })),
		).toEqual({
			subject: "reviewer",
			meta: "失敗",
			mark: "failed",
		});
	});

	it("single child opens the detail directly", () => {
		expect(toolRowTarget(parallel)).toBeNull();
		expect(toolRowTarget(run({ id: "s", children: [child({ id: "only" })] }))).toEqual({ childId: "only" });
	});
});

describe("detail", () => {
	const models = [{ provider: "anthropic", id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }] as never;

	it("subtitle and state", () => {
		const c = child({
			id: "c",
			model: "anthropic/claude-sonnet-5-5",
			usage: { costUsd: 0.17 },
			startedAt: NOW - 252_000,
		});
		const r = run({ id: "r", children: [c] });
		expect(childModelLabel("anthropic/claude-sonnet-5-5", models)).toBe("Sonnet 5.5");
		expect(childModelLabel("x/unknown-model", models)).toBe("unknown-model");
		expect(detailSubtitle(r, c, models)).toBe("reviewer · Sonnet 5.5 · $0.17");
		expect(detailState(c, r, NOW)).toBe("作業中 · 4:12");
		const chain = run({
			id: "ch",
			mode: "chain",
			stage: { index: 0, count: 3 },
			children: [
				child({ id: "s", agent: "scout", model: "haiku-5-5" }),
				child({ id: "p", agent: "planner", index: 1 }),
			],
		});
		expect(detailSubtitle(chain, chain.children[0]!, null)).toBe("scout · haiku-5-5 · チェーン 1 / 3");
		expect(chainSteps(chain, chain.children[0]!)).toEqual([
			{ id: "s", agent: "scout", current: true },
			{ id: "p", agent: "planner", current: false },
		]);
		expect(chainSteps(parallel, parallel.children[0]!)).toBeNull();
	});

	it("findChild", () => {
		expect(findChild([parallel], "r1", "c2")?.child.title).toBe("テストのレビュー");
		expect(findChild([parallel], "r1", "nope")).toBeNull();
	});

	it("gates controls by actions", () => {
		const full = run({
			id: "r",
			actions: ["stop", "interrupt"],
			children: [child({ id: "c", actions: ["steer", "follow_up", "stop_child", "resume"] })],
		});
		expect(childControls(full, full.children[0]!)).toEqual({
			modes: ["steer", "follow_up"],
			stop: { action: "stop_child", runWide: false },
			resume: false,
			abortParent: false,
			canSend: true,
		});
		const queued = child({ id: "queued", state: "queued", actions: ["stop_child"] });
		expect(childControls(full, queued)).toMatchObject({
			canSend: false,
			stop: { action: "stop_child", runWide: false },
			abortParent: false,
		});
		const stopOnly = run({ id: "stop-only", actions: ["stop"], children: [child({ id: "c" })] });
		expect(childControls(stopOnly, stopOnly.children[0]!)).toMatchObject({
			canSend: false,
			stop: { action: "stop", runWide: false },
		});

		const done = { ...full.children[0]!, state: "complete" as const };
		expect(childControls(full, done)).toMatchObject({ stop: null, resume: true, canSend: true });
		const stopping = { ...full.children[0]!, state: "stopping" as const };
		expect(childControls(full, stopping).stop).toBeNull();
		const example = run({ id: "e", backend: "example", actions: ["abort_parent"], children: [child({ id: "x" })] });
		expect(childControls(example, example.children[0]!)).toEqual({
			modes: [],
			stop: null,
			resume: false,
			abortParent: true,
			canSend: false,
		});
		const fg = run({
			id: "f",
			background: false,
			actions: ["interrupt"],
			children: [child({ id: "a" }), child({ id: "b" })],
		});
		expect(childControls(fg, fg.children[0]!).stop).toEqual({ action: "interrupt", runWide: true });
	});
});

describe("work record rows", () => {
	const items: TranscriptItem[] = [
		{
			kind: "assistant",
			entryId: "a1",
			text: "",
			thinking: "考える",
			toolCalls: [{ id: "t1", name: "read", args: { path: "src/a.ts" } }],
		} as TranscriptItem,
		{ kind: "tool_result", entryId: "r1", toolCallId: "t1", toolName: "read", text: "x\ny", isError: false },
		{ kind: "assistant", entryId: "a2", text: "見つけました", toolCalls: [] } as TranscriptItem,
		{ kind: "user", entryId: "u1", text: "トークン更新を優先して" },
		{ kind: "user", entryId: "u2", text: "別の指示" },
	];

	it("merges cursor pages without duplicates", () => {
		const a = items.slice(0, 2);
		const merged = mergeTranscript(a, items.slice(1, 4));
		expect(merged.map((i) => i.entryId)).toEqual(["a1", "r1", "a2", "u1"]);
		expect(mergeTranscript(a, [])).toBe(a);
	});

	it("renders chat rows with captions for user messages", () => {
		const rows = subagentRows(items, "running", [{ text: "トークン更新を優先して", action: "steer" }]);
		const kinds = rows.map((r) => r.kind);
		expect(kinds).toContain("thinking");
		expect(kinds).toContain("tool");
		expect(kinds).toContain("text");
		const users = rows.filter((r) => r.kind === "user") as { caption?: string }[];
		expect(users.map((u) => u.caption)).toEqual(["あなた · 割り込み", "追加の指示"]);
	});
});

describe("drawer", () => {
	const summary = (id: string, patch: Partial<InstanceSummary> = {}): InstanceSummary => ({
		instanceId: id,
		cwd: "/home/me/work/api",
		origin: "pc",
		abducoSession: null,
		pcAttached: null,
		session: { id: `s-${id}`, name: id },
		status: "idle",
		startedAt: 0,
		updatedAt: 0,
		...patch,
	});
	const host = (instances: InstanceSummary[]) =>
		({ hostId: "h", hostName: "mac", state: "connected", instances }) as unknown as HostRuntime;

	it("formats subagent activity", () => {
		expect(drawerSubagentText(null)).toBeNull();
		expect(drawerSubagentText({ active: 0, waiting: 0, paused: 0, failed: 3 })).toBeNull();
		expect(drawerSubagentText({ active: 2, waiting: 0, paused: 0, failed: 1 })).toBe("サブエージェント 2 実行中");
		expect(drawerSubagentText({ active: 3, waiting: 1, paused: 1, failed: 0 })).toBe(
			"サブエージェント 2 実行中 · 1 待ち · 1 一時停止",
		);
	});

	it("a waiting subagent puts an idle parent under 要対応", () => {
		const g = buildDrawerGroups([
			host([
				summary("a", { subagents: { active: 2, waiting: 0, paused: 0, failed: 0 } }),
				summary("b", { subagents: { active: 1, waiting: 1, paused: 0, failed: 0 } }),
				summary("c"),
			]),
		]);
		expect(g.attention.map((r) => r.instanceId)).toEqual(["b"]);
		expect(g.hosts[0]?.rows.map((r) => [r.instanceId, drawerSubagentText(r.subagents)])).toEqual([
			["a", "サブエージェント 2 実行中"],
			["c", null],
		]);
	});
});

describe("chat rows", () => {
	it("keeps a subagent call with a known run out of the folded turn", () => {
		const items: TranscriptItem[] = [
			{ kind: "user", entryId: "u1", text: "レビューして" },
			{
				kind: "assistant",
				entryId: "a1",
				text: "",
				toolCalls: [
					{ id: "tc1", name: "subagent", args: {} },
					{ id: "t2", name: "read", args: { path: "a.ts" } },
				],
			} as TranscriptItem,
			{ kind: "tool_result", entryId: "r1", toolCallId: "tc1", toolName: "subagent", text: "ok", isError: false },
			{ kind: "tool_result", entryId: "r2", toolCallId: "t2", toolName: "read", text: "x", isError: false },
			{ kind: "assistant", entryId: "a2", text: "起動しました", toolCalls: [] } as TranscriptItem,
		];
		const base: InstanceView = { ...createView("i"), phase: "ready", items, status: "idle" };
		const plain = buildRows(base);
		expect(plain.find((r) => r.kind === "tool" && r.toolCallId === "tc1")?.fold).toBeDefined();
		const withRun = buildRows({ ...base, subagents: { runs: [parallel], backends: [] } });
		const row = withRun.find((r) => r.kind === "tool" && r.toolCallId === "tc1");
		expect(row?.fold).toBeUndefined();
		expect(withRun.find((r) => r.kind === "turnSummary")).toMatchObject({ tools: 1 });
	});

	it("queued children are not shown as working", () => {
		expect(childMark("queued")).toBe("idle");
		expect(childMark("running")).toBe("running");
		expect(childMark("waiting")).toBe("waiting");
	});
});
