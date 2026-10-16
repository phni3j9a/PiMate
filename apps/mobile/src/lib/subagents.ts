/**
 * Subagent presentation (pure, no React Native imports): the summary line above the composer, the list sheet,
 * the chat `subagent` tool row and the child detail screen (docs/SPEC.md「サブエージェント」,
 * docs/design/html/{Chat-Subagents,Sheet-Subagents,Subagent-Detail,Subagent-Detail-Readonly}.html).
 *
 * Runs come normalized from the RC (docs/subagents.md). Unknown fields, states and actions are ignored; an
 * unsupported backend adds nothing (its tool rows stay plain).
 */
import {
	isSubagentActive,
	type ModelInfo,
	type SubagentAction,
	type SubagentChild,
	type SubagentRun,
	type SubagentState,
	type SubagentsState,
} from "@pimate/protocol";
import { ago, elapsed } from "./format";
import { formatCost, shortModelName } from "./sessionInfo";

export type SubagentMark = "running" | "waiting" | "failed" | "done" | "idle";

/** Backend success replies can contain a full task and internal paths; keep the composer feedback bounded. */
export const CONTROL_FEEDBACK: Record<SubagentAction, string> = {
	steer: "指示を送信しました。作業の区切りで反映されます。",
	follow_up: "追加の依頼を送信しました。",
	resume: "続きの実行を開始しました。",
	interrupt: "一時停止を依頼しました。",
	stop: "停止を依頼しました。",
	stop_child: "このサブエージェントの停止を依頼しました。",
	abort_parent: "親の Pi の停止を依頼しました。",
};

const STATES: ReadonlySet<string> = new Set([
	"queued",
	"running",
	"waiting",
	"paused",
	"stopping",
	"complete",
	"failed",
	"stopped",
	"unknown",
]);
const MODES: ReadonlySet<string> = new Set(["single", "parallel", "chain", "workflow", "unknown"]);
const ACTIONS: ReadonlySet<string> = new Set([
	"steer",
	"follow_up",
	"interrupt",
	"resume",
	"stop",
	"stop_child",
	"abort_parent",
]);

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const state = (v: unknown): SubagentState =>
	typeof v === "string" && STATES.has(v) ? (v as SubagentState) : "unknown";
const actions = (v: unknown): SubagentAction[] =>
	Array.isArray(v) ? (v.filter((a) => typeof a === "string" && ACTIONS.has(a)) as SubagentAction[]) : [];

function normalizeChild(raw: unknown, index: number): SubagentChild | null {
	if (!raw || typeof raw !== "object") return null;
	const c = raw as Partial<SubagentChild>;
	const id = str(c.id) ?? (num(c.index) ?? index).toString();
	return {
		...c,
		id,
		index: num(c.index) ?? index,
		agent: str(c.agent) ?? "subagent",
		title: str(c.title),
		state: state(c.state),
		hasTranscript: c.hasTranscript === true,
		actions: actions(c.actions),
	};
}

/** Defensive copy of a run from the wire: unknown states → "unknown", unknown actions dropped. Null without id. */
export function normalizeRun(raw: unknown): SubagentRun | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Partial<SubagentRun>;
	const id = str(r.id);
	if (!id) return null;
	const children = Array.isArray(r.children)
		? r.children.map(normalizeChild).filter((c): c is SubagentChild => c !== null)
		: [];
	return {
		...r,
		id,
		backend: r.backend ?? ("unknown" as SubagentRun["backend"]),
		background: r.background === true,
		mode: typeof r.mode === "string" && MODES.has(r.mode) ? r.mode : "unknown",
		state: state(r.state),
		children,
		actions: actions(r.actions),
	};
}

/** Backend support from the RC; runs of a backend marked unsupported are dropped. */
export function normalizeState(raw: SubagentsState | undefined | null): SubagentsState {
	const backends = Array.isArray(raw?.backends) ? raw.backends.filter((b) => b && typeof b.backend === "string") : [];
	const unsupported = new Set(backends.filter((b) => b.supported === false).map((b) => b.backend));
	const runs = (Array.isArray(raw?.runs) ? raw.runs : [])
		.map(normalizeRun)
		.filter((r): r is SubagentRun => r !== null && !unsupported.has(r.backend));
	return { runs, backends };
}

/** Replaces the run with the same id (keeping its position) or adds it. Unsupported backends are ignored. */
export function upsertRun(current: SubagentsState, raw: unknown): SubagentsState {
	const run = normalizeRun(raw);
	if (!run) return current;
	if (current.backends.some((b) => b.backend === run.backend && b.supported === false)) return current;
	const index = current.runs.findIndex((r) => r.id === run.id);
	const runs = index < 0 ? [...current.runs, run] : current.runs.map((r, i) => (i === index ? run : r));
	return { ...current, runs };
}

/** The run's children; a run known only by its state counts as one child. */
function units(run: SubagentRun): { state: SubagentState }[] {
	return run.children.length > 0 ? run.children : [{ state: run.state }];
}

export function runActive(run: SubagentRun): boolean {
	return isSubagentActive(run.state) || run.children.some((c) => isSubagentActive(c.state));
}

/** Still in progress in a broad sense: running, waiting, or paused (resumable). Finished runs go to 以前の実行. */
export function runOpen(run: SubagentRun): boolean {
	return runActive(run) || run.state === "paused" || run.children.some((c) => c.state === "paused");
}

// ---------------------------------------------------------------- summary line (Chat-Subagents)

export interface StateCounts {
	running: number;
	waiting: number;
	paused: number;
	complete: number;
	failed: number;
	stopped: number;
}

export function stateCounts(runs: readonly SubagentRun[]): StateCounts {
	const c: StateCounts = { running: 0, waiting: 0, paused: 0, complete: 0, failed: 0, stopped: 0 };
	for (const run of runs) {
		// Later chain steps wait in "queued" behind a running one; they are not running yet.
		const started = run.children.some((ch) => ch.state !== "queued");
		for (const u of units(run)) {
			if (u.state === "queued" && started) continue;
			if (u.state === "queued" || u.state === "running" || u.state === "stopping") c.running++;
			else if (u.state === "waiting") c.waiting++;
			else if (u.state === "paused") c.paused++;
			else if (u.state === "complete") c.complete++;
			else if (u.state === "failed") c.failed++;
			else if (u.state === "stopped") c.stopped++;
		}
	}
	return c;
}

const COUNT_LABELS: [keyof StateCounts, string][] = [
	["running", "実行中"],
	["waiting", "待ち"],
	["paused", "一時停止"],
	["complete", "完了"],
	["failed", "失敗"],
	["stopped", "停止"],
];

/** "2 実行中 · 1 完了" (zero counts left out). */
export function countsText(c: StateCounts): string {
	return COUNT_LABELS.filter(([k]) => c[k] > 0)
		.map(([k, label]) => `${c[k]} ${label}`)
		.join(" · ");
}

/** Mark for a group: anything working → spinner, then waiting, failure, pause, done. */
export function countsMark(c: StateCounts): SubagentMark {
	if (c.running) return "running";
	if (c.waiting) return "waiting";
	if (c.failed) return "failed";
	if (c.paused) return "idle";
	return "done";
}

export interface SubagentSummary {
	mark: SubagentMark;
	text: string;
	label: string;
}

/**
 * The line above the composer: shown while any child is active, and after they finish until the next prompt is
 * sent (`watch` holds the runs seen active since the last prompt).
 */
export function subagentSummary(runs: readonly SubagentRun[], watch: readonly string[]): SubagentSummary | null {
	const shown = runs.filter((r) => runActive(r) || watch.includes(r.id));
	if (!shown.length) return null;
	const c = stateCounts(shown);
	const text = countsText(c);
	if (!text) return null;
	const spoken = COUNT_LABELS.filter(([k]) => c[k] > 0)
		.map(([k, label]) => `${c[k]} 件${label}`)
		.join("、");
	return { mark: countsMark(c), text, label: `サブエージェント: ${spoken}。一覧を開く` };
}

/** Run ids for `watch` after an update: active runs are added; finished ones stay until the next prompt. */
export function watchRuns(watch: readonly string[], runs: readonly SubagentRun[]): string[] {
	const ids = new Set(runs.map((r) => r.id));
	const next = watch.filter((id) => ids.has(id));
	for (const run of runs) if (runActive(run) && !next.includes(run.id)) next.push(run.id);
	return next.length === watch.length && next.every((id, i) => id === watch[i]) ? (watch as string[]) : next;
}

/** On a new prompt: forget finished runs (active ones stay). */
export function clearFinishedWatch(watch: readonly string[], runs: readonly SubagentRun[]): string[] {
	const next = watch.filter((id) => runs.some((r) => r.id === id && runActive(r)));
	return next.length === watch.length ? (watch as string[]) : next;
}

// ---------------------------------------------------------------- list sheet (Sheet-Subagents)

const MODE_LABEL: Record<string, string> = {
	single: "単体",
	parallel: "並列",
	chain: "チェーン",
	workflow: "ワークフロー",
};

export function modeLabel(run: SubagentRun): string | null {
	return MODE_LABEL[run.mode] ?? null;
}

/** Section header of a run: "並列 · バックグラウンド", "チェーン 1 / 3". */
export function runLabel(run: SubagentRun): string {
	const parts: string[] = [];
	const mode = modeLabel(run);
	if (run.mode === "chain" && run.stage) parts.push(`チェーン ${run.stage.index + 1} / ${run.stage.count}`);
	else if (mode) parts.push(mode);
	else parts.push("サブエージェント");
	if (run.background) parts.push("バックグラウンド");
	return parts.join(" · ");
}

export interface StopControl {
	action: "stop" | "interrupt" | "abort_parent";
	label: string;
	title: string;
	message: string;
	confirm: string;
}

/** The one run-wide stop the backend allows (stop > interrupt > abort_parent), or null. */
export function runStop(run: SubagentRun): StopControl | null {
	if (run.actions.includes("stop"))
		return {
			action: "stop",
			label: "停止…",
			title: "この実行を止めますか？",
			message: "実行中のサブエージェントをすべて止めます。親の Pi は止まりません。",
			confirm: "停止",
		};
	if (run.actions.includes("interrupt"))
		return {
			action: "interrupt",
			label: "中断…",
			title: "この実行を中断しますか？",
			message: "サブエージェントを一時停止します。あとで続きを依頼できます。",
			confirm: "中断",
		};
	if (run.actions.includes("abort_parent"))
		return {
			action: "abort_parent",
			label: "すべて停止…",
			title: "すべて止めますか？",
			message: "この Extension では、止めると親の Pi の作業もまとめて止まります。",
			confirm: "すべて停止",
		};
	return null;
}

export function childMark(s: SubagentState): SubagentMark {
	switch (s) {
		case "running":
		case "stopping":
			return "running";
		case "waiting":
			return "waiting";
		case "failed":
			return "failed";
		case "complete":
			return "done";
		default:
			return "idle";
	}
}

export const childTitle = (child: SubagentChild) => child.title?.trim() || child.agent;

/** Elapsed time of a child on the phone clock; null when the backend gave no start time. */
export function childElapsed(child: SubagentChild, run: SubagentRun, now: number): string | null {
	const start = child.startedAt ?? (run.children.length <= 1 ? run.startedAt : undefined);
	if (start === undefined) return null;
	const end = child.endedAt ?? (isSubagentActive(child.state) ? now : (run.endedAt ?? run.updatedAt ?? now));
	return elapsed(end - start);
}

export type LineTone = "mono" | "normal" | "waiting" | "failed";

/** Second line of a child row: current activity (mono), or its state in words. */
export function childLine(
	child: SubagentChild,
	run: SubagentRun,
	opts: { previous?: boolean; now?: number } = {},
): { text: string; tone: LineTone } {
	const when = opts.previous && opts.now !== undefined ? (child.endedAt ?? run.endedAt ?? run.updatedAt) : undefined;
	const withTime = (text: string) => (when !== undefined ? `${text} · ${ago(when, opts.now!)}` : text);
	switch (child.state) {
		case "running":
			if (child.activity?.tool)
				return { text: [child.activity.tool, child.activity.args].filter(Boolean).join("  "), tone: "mono" };
			return { text: "作業中", tone: "normal" };
		case "queued":
			return { text: "開始待ち", tone: "normal" };
		case "waiting":
			return {
				text: child.question ? `待ち · ${oneLine(child.question)}` : "待ち · 要対応",
				tone: "waiting",
			};
		case "paused":
			return { text: "一時停止", tone: "normal" };
		case "stopping":
			return { text: "停止しています…", tone: "normal" };
		case "complete":
			return { text: withTime("完了"), tone: "normal" };
		case "failed": {
			const error = child.error ?? run.error ?? (child.exitCode ? `終了コード ${child.exitCode}` : undefined);
			return { text: error ? `失敗 · ${oneLine(error)}` : "失敗", tone: "failed" };
		}
		case "stopped":
			return { text: withTime("停止"), tone: "normal" };
		default:
			return { text: "状態不明", tone: "normal" };
	}
}

function oneLine(text: string): string {
	const line = text.trim().split("\n")[0] ?? "";
	return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}

/** Children of a run; a run without children shows one synthetic row (not openable). */
export function runChildren(run: SubagentRun): SubagentChild[] {
	if (run.children.length) return [...run.children].sort((a, b) => a.index - b.index);
	return [{ id: "", index: 0, agent: "subagent", state: run.state, hasTranscript: false, actions: [] }];
}

export interface SheetSections {
	open: SubagentRun[];
	previous: { run: SubagentRun; child: SubagentChild }[];
}

const runTime = (r: SubagentRun) => r.updatedAt ?? r.endedAt ?? r.startedAt ?? 0;

/** Runs in progress (newest first) and finished children of earlier runs (newest first). */
export function sheetSections(runs: readonly SubagentRun[]): SheetSections {
	const sorted = [...runs].sort((a, b) => (b.startedAt ?? runTime(b)) - (a.startedAt ?? runTime(a)));
	const open = sorted.filter(runOpen);
	const previous = sorted
		.filter((r) => !runOpen(r))
		.sort((a, b) => runTime(b) - runTime(a))
		.flatMap((run) => runChildren(run).map((child) => ({ run, child })));
	return { open, previous };
}

/** "48.6K" */
export function compactTokens(n: number): string {
	if (n < 1000) return String(Math.round(n));
	if (n < 100_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
	return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function usageTokens(u: SubagentRun["usage"]): number | undefined {
	if (!u) return undefined;
	if (u.total !== undefined) return u.total;
	if (u.input === undefined && u.output === undefined) return undefined;
	return (u.input ?? 0) + (u.output ?? 0);
}

const add = (a: number | undefined, b: number | undefined) => (b === undefined ? a : (a ?? 0) + b);

/** The run's own usage when reported, else the sum of its children. */
function runTotals(run: SubagentRun): { tokens?: number; cost?: number } {
	let tokens = usageTokens(run.usage);
	let cost = run.usage?.costUsd;
	const ownTokens = tokens !== undefined;
	const ownCost = cost !== undefined;
	for (const c of run.children) {
		if (!ownTokens) tokens = add(tokens, usageTokens(c.usage));
		if (!ownCost) cost = add(cost, c.usage?.costUsd);
	}
	return { tokens, cost };
}

export interface SheetHeader {
	tokens: string | null;
	cost: string | null;
	backend: string | null;
}

/** "トークン 48.6K · コスト $0.39 · pi-subagents" — sums over the runs; unknown parts are left out. */
export function sheetHeader(runs: readonly SubagentRun[]): SheetHeader {
	let tokens: number | undefined;
	let cost: number | undefined;
	for (const run of runs) {
		const t = runTotals(run);
		if (t.tokens !== undefined) tokens = (tokens ?? 0) + t.tokens;
		if (t.cost !== undefined) cost = (cost ?? 0) + t.cost;
	}
	const backends = [...new Set(runs.map((r) => r.backend))].filter(
		(b): b is SubagentRun["backend"] => b === "pi-subagents" || b === "example",
	);
	return {
		tokens: tokens ? compactTokens(tokens) : null,
		cost: cost ? formatCost(cost) : null,
		backend: backends.length ? backends.map((b) => (b === "example" ? "公式サンプル" : b)).join(" · ") : null,
	};
}

// ---------------------------------------------------------------- chat tool row (Chat-Subagents)

export function findRunByToolCall(runs: readonly SubagentRun[], toolCallId: string): SubagentRun | undefined {
	// A resumed run can share the parent tool call; the original one (first) is what the row started.
	return runs.find((r) => r.toolCallId === toolCallId);
}

export function findChild(
	runs: readonly SubagentRun[],
	runId: string,
	childId: string,
): { run: SubagentRun; child: SubagentChild } | null {
	const run = runs.find((r) => r.id === runId);
	const child = run?.children.find((c) => c.id === childId);
	return run && child ? { run, child } : null;
}

/** Agents of a run: "reviewer × 3", "scout → planner → worker", "scout, worker". */
export function agentsText(run: SubagentRun): string {
	const agents = runChildren(run).map((c) => c.agent);
	if (run.mode === "chain") return agents.join(" → ");
	const distinct = [...new Set(agents)];
	if (distinct.length === 1) return agents.length > 1 ? `${distinct[0]} × ${agents.length}` : distinct[0]!;
	return distinct.join(", ");
}

/** The `subagent` tool row: "reviewer × 3 · 並列" and the right-hand state "2 実行中". */
export function toolRowInfo(run: SubagentRun): { subject: string; meta: string; mark: SubagentMark } {
	const mode = run.mode === "parallel" || run.mode === "chain" || run.mode === "workflow" ? modeLabel(run) : null;
	const subject = [agentsText(run), mode].filter(Boolean).join(" · ");
	const c = stateCounts([run]);
	let meta: string;
	if (c.running) meta = `${c.running} 実行中`;
	else if (c.waiting) meta = `${c.waiting} 待ち`;
	else if (c.paused) meta = "一時停止";
	else if (c.failed) meta = run.children.length > 1 ? `${c.failed} 失敗` : "失敗";
	else if (c.stopped && !c.complete) meta = "停止";
	else meta = "完了";
	return { subject, meta, mark: countsMark(c) };
}

/** Where a tap on the tool row goes: straight to the child when there is only one with a record. */
export function toolRowTarget(run: SubagentRun): { childId: string } | null {
	return run.children.length === 1 ? { childId: run.children[0]!.id } : null;
}

// ---------------------------------------------------------------- detail screen (Subagent-Detail)

/** "Sonnet 5.5" from "anthropic/claude-sonnet-5-5" when the model list knows it, else the bare id. */
export function childModelLabel(
	model: string | undefined,
	models: readonly ModelInfo[] | null | undefined,
): string | null {
	if (!model) return null;
	const slash = model.indexOf("/");
	const provider = slash > 0 ? model.slice(0, slash) : undefined;
	const id = slash > 0 ? model.slice(slash + 1) : model;
	const info = models?.find((m) => m.id === id && (!provider || m.provider === provider));
	return info ? shortModelName(info.name) : id;
}

/** "reviewer · Sonnet 5.5 · $0.17" / "scout · Haiku 5.5 · チェーン 1 / 3" */
export function detailSubtitle(
	run: SubagentRun,
	child: SubagentChild,
	models: readonly ModelInfo[] | null | undefined,
): string {
	const parts: string[] = [child.agent];
	const model = childModelLabel(child.model, models);
	if (model) parts.push(model);
	if (run.mode === "chain") {
		const count = run.stage?.count ?? run.children.length;
		if (count > 1) parts.push(`チェーン ${child.index + 1} / ${count}`);
	} else if (child.usage?.costUsd) parts.push(formatCost(child.usage.costUsd));
	return parts.join(" · ");
}

const STATE_WORD: Record<SubagentState, string> = {
	queued: "開始待ち",
	running: "作業中",
	waiting: "待ち",
	paused: "一時停止",
	stopping: "停止中",
	complete: "完了",
	failed: "失敗",
	stopped: "停止",
	unknown: "状態不明",
};

/** Header state: "作業中 · 4:12". */
export function detailState(child: SubagentChild, run: SubagentRun, now: number): string {
	const time = childElapsed(child, run, now);
	return time ? `${STATE_WORD[child.state]} · ${time}` : STATE_WORD[child.state];
}

export interface ChildControls {
	/** Only steer is offered; follow_up-only children remain read-only. */
	steer: boolean;
	/** Stop for this child: stop_child, else the whole run's stop / interrupt. */
	stop: { action: "stop_child" | "stop" | "interrupt"; runWide: boolean } | null;
	/** Continue a finished/paused child with a message (starts a new run). */
	resume: boolean;
	/** Official example: the only operation is aborting the parent turn. */
	abortParent: boolean;
	/** Text input is independent of stop-only controls (e.g. a queued child). */
	canSend: boolean;
}

export function childControls(run: SubagentRun, child: SubagentChild): ChildControls {
	const steer = child.actions.includes("steer");
	let stop: ChildControls["stop"] = null;
	const working = isSubagentActive(child.state) && child.state !== "stopping";
	if (working && child.actions.includes("stop_child")) stop = { action: "stop_child", runWide: false };
	else if (working && run.actions.includes("stop")) stop = { action: "stop", runWide: run.children.length > 1 };
	else if (working && run.actions.includes("interrupt"))
		stop = { action: "interrupt", runWide: run.children.length > 1 };
	const resume = child.actions.includes("resume") && !isSubagentActive(child.state);
	const abortParent = run.actions.includes("abort_parent");
	return { steer, stop, resume, abortParent, canSend: steer || resume };
}

/** Chain agents for the request card, with the current step marked. */
export function chainSteps(
	run: SubagentRun,
	child: SubagentChild,
): { id: string; agent: string; current: boolean }[] | null {
	if (run.mode !== "chain" || run.children.length < 2) return null;
	return runChildren(run).map((c) => ({ id: c.id, agent: c.agent, current: c.id === child.id }));
}
