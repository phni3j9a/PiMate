import type {
	SubagentAction,
	SubagentBackend,
	SubagentChild,
	SubagentMode,
	SubagentRun,
	SubagentState,
	SubagentUsage,
} from "@pimate/protocol";
import { isSubagentActive } from "@pimate/protocol";

// These artifacts are extension-owned, versioned JSON, not a stable Pi API. Read only recognized fields.
export function record(value: unknown): Record<string, any> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}
export function list(value: unknown): Record<string, any>[] {
	return Array.isArray(value) ? value.map(record) : [];
}
export function string(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
export function number(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
export function classify(details: unknown): SubagentBackend | undefined {
	const d = record(details);
	const results = list(d.results);
	if (
		"agentScope" in d &&
		"projectAgentsDir" in d &&
		results.some((r) => Array.isArray(r.messages) && typeof r.agentSource === "string")
	)
		return "example";
	if (
		typeof d.runId === "string" ||
		typeof d.asyncId === "string" ||
		typeof d.asyncDir === "string" ||
		Array.isArray(d.progress) ||
		results.some((r) => typeof r.transcriptPath === "string" || r.artifactPaths || r.progress)
	)
		return "pi-subagents";
	return undefined;
}
export function state(value: unknown, activity?: unknown): SubagentState {
	// Terminal lifecycle wins over stale activity left in status.json.
	if (["complete", "completed", "done"].includes(String(value))) return "complete";
	if (["failed", "error", "partial", "rejected"].includes(String(value))) return "failed";
	if (["stopped", "cancelled", "aborted"].includes(String(value))) return "stopped";
	if (value === "paused" || value === "stopping") return value;
	if ([value, activity].some((v) => ["needs_attention", "supervisor_request", "waiting"].includes(String(v))))
		return "waiting";
	if (["running", "started", "active"].includes(String(value))) return "running";
	if (["queued", "pending"].includes(String(value))) return "queued";
	return "unknown";
}
function mode(value: unknown): SubagentMode {
	return ["single", "parallel", "chain", "workflow"].includes(String(value)) ? (value as SubagentMode) : "unknown";
}
function usage(value: unknown, cost?: unknown): SubagentUsage | undefined {
	const v = record(value);
	const input = number(v.input ?? v.inputTokens);
	const output = number(v.output ?? v.outputTokens);
	const total =
		number(v.total) ?? (input !== undefined || output !== undefined ? (input ?? 0) + (output ?? 0) : undefined);
	const costUsd = number(record(cost).costUsd) ?? number(v.cost) ?? number(record(v.cost).total);
	return total !== undefined || costUsd !== undefined ? { input, output, total, costUsd } : undefined;
}
function sumUsage(children: SubagentChild[]): SubagentUsage | undefined {
	const values = children.flatMap((c) => (c.usage ? [c.usage] : []));
	if (!values.length) return undefined;
	return Object.fromEntries(
		(["input", "output", "total", "costUsd"] as const).flatMap((key) => {
			const numbers = values.flatMap((v) => (v[key] === undefined ? [] : [v[key]!]));
			return numbers.length ? [[key, numbers.reduce((a, b) => a + b, 0)]] : [];
		}),
	);
}
export function childActions(run: SubagentRun, child: SubagentChild, source: Record<string, any>): SubagentAction[] {
	if (run.backend !== "pi-subagents" || !run.background) return [];
	if (["running", "waiting"].includes(child.state) && isSubagentActive(run.state))
		return [
			"steer",
			"follow_up",
			...(run.mode === "parallel" && typeof source.childId === "string" ? ["stop_child" as const] : []),
		];
	if (
		child.state === "queued" &&
		isSubagentActive(run.state) &&
		run.mode === "parallel" &&
		typeof source.childId === "string"
	)
		return ["stop_child"];
	if (
		["paused", "complete", "failed", "stopped"].includes(child.state) &&
		(source.transcriptPath || source.sessionFile) &&
		(child.state !== "stopped" || source.resumable === true || run.state === "paused")
	)
		return ["resume"];
	return [];
}
export function setActions(run: SubagentRun, sources: Record<string, any>[], runningTool = false): void {
	run.actions =
		run.backend === "example"
			? runningTool
				? ["abort_parent"]
				: []
			: isSubagentActive(run.state)
				? run.background
					? ["interrupt", "stop"]
					: runningTool
						? ["interrupt"]
						: []
				: [];
	run.children.forEach((child, i) => {
		child.actions = childActions(run, child, sources[i] ?? {});
	});
}
export function normalizeStatus(value: unknown, previous?: SubagentRun): SubagentRun {
	const d = record(value);
	const sources = list(d.steps);
	const run: SubagentRun = {
		id: String(d.runId),
		backend: "pi-subagents",
		background: true,
		mode: mode(d.mode),
		toolCallId: string(d.toolCallId) ?? previous?.toolCallId,
		state: state(d.state, d.activityState),
		startedAt: number(d.startedAt),
		endedAt: number(d.endedAt),
		updatedAt: number(d.lastUpdate),
		children: sources.map((s, index) => normalizeChild(s, index)),
		error: string(d.error),
		actions: [],
		resumedFrom: previous?.resumedFrom,
		resumedAs: previous?.resumedAs,
	};
	if (run.mode === "chain" && number(d.currentStep) !== undefined && number(d.chainStepCount) !== undefined)
		run.stage = { index: d.currentStep, count: d.chainStepCount };
	run.usage = usage(d.totalTokens, d.totalCost) ?? sumUsage(run.children);
	setActions(run, sources);
	return run;
}
function normalizeChild(s: Record<string, any>, index: number): SubagentChild {
	const agent = string(s.agent) ?? "subagent";
	const title = string(s.sessionName ?? s.label ?? s.description ?? s.task);
	const progress = record(s.progress);
	return {
		id: string(s.childId) ?? `step:${index}`,
		index: number(s.index) ?? index,
		agent,
		title: title?.replace(new RegExp(`^${agent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`), "").slice(0, 160),
		state: state(s.status, s.activityState),
		model: string(s.model ?? s.launchModel ?? s.requestedModel),
		thinking: string(s.thinking),
		startedAt: number(s.startedAt),
		endedAt: number(s.endedAt),
		error: string(s.error ?? s.errorMessage),
		exitCode: s.exitCode === null ? null : number(s.exitCode),
		activity:
			typeof (s.currentTool ?? progress.currentTool) === "string"
				? {
						tool: s.currentTool ?? progress.currentTool,
						args: string(s.currentToolArgs ?? progress.currentToolArgs),
						startedAt: number(s.currentToolStartedAt ?? progress.currentToolStartedAt),
					}
				: undefined,
		usage: usage(
			s.usage ??
				(typeof s.tokens === "number" ? { input: s.inputTokens, output: s.outputTokens, total: s.tokens } : s.tokens),
			s.totalCost,
		),
		hasTranscript: !!string(s.transcriptPath ?? record(s.artifactPaths).transcriptPath) || Array.isArray(s.messages),
		actions: [],
	};
}
export function normalizeTool(
	details: unknown,
	toolCallId: string,
	running: boolean,
	startedAt?: number,
	isError = false,
): SubagentRun | undefined {
	const backend = classify(details);
	if (!backend) return;
	const d = record(details);
	if (d.asyncDir || d.asyncId) return; // Async launch, not a foreground run.
	const results = list(d.results);
	const progress = list(d.progress);
	if (!results.length && !progress.length) return;
	const sources = results.length ? results : progress;
	const run: SubagentRun = {
		id: string(d.runId) ?? `tool:${toolCallId}`,
		backend,
		background: false,
		mode: mode(d.mode),
		toolCallId,
		state: running ? "running" : isError ? "failed" : "complete",
		startedAt,
		children: [],
		actions: [],
	};
	run.children = sources.map((s, index) => {
		const p = progress.find((p) => p.index === (s.index ?? index)) ?? record(s.progress);
		const child = normalizeChild(
			{ ...s, ...p, usage: s.usage, transcriptPath: s.transcriptPath, messages: s.messages },
			index,
		);
		if (backend === "example") {
			child.state =
				s.errorMessage || ["error", "aborted"].includes(s.stopReason) || s.exitCode > 0
					? "failed"
					: running
						? s.exitCode === -1
							? "queued"
							: run.mode !== "single" && s.stopReason === "stop"
								? "complete"
								: "running"
						: s.exitCode === -1
							? "stopped"
							: "complete";
		} else if (child.state === "unknown" || !running) {
			child.state = running
				? "running"
				: (s.exitCode && s.exitCode !== 0) || s.errorMessage || isError
					? "failed"
					: "complete";
		}
		return child;
	});
	if (!running && run.children.some((c) => c.state === "failed")) run.state = "failed";
	run.usage = usage(d.totalChildUsage, d.totalCost) ?? sumUsage(run.children);
	if (run.mode === "chain") run.stage = { index: Math.max(0, run.children.length - 1), count: run.children.length };
	setActions(run, sources, running);
	return run;
}
