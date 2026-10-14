// Normalized subagent model (M4). The RC builds it from the official `subagent` example (parent tool
// progress) and pi-subagents (in-process RPC status, run status.json, child transcript files).
// Clients must ignore unknown fields/values and fall back to a plain tool row when a run is not known.

import type { TranscriptItem } from "./index.ts";

/** Which extension produced the run. Both register a tool named `subagent`; the RC tells them apart by details shape. */
export type SubagentBackend = "pi-subagents" | "example";

/**
 * - waiting: the child asked its parent (pi-subagents `contact_supervisor`) and waits for a reply.
 * - stopping: a stop was requested and not yet confirmed.
 * - unknown: the backend reported a state the RC does not understand.
 */
export type SubagentState =
	| "queued"
	| "running"
	| "waiting"
	| "paused"
	| "stopping"
	| "complete"
	| "failed"
	| "stopped"
	| "unknown";

export type SubagentMode = "single" | "parallel" | "chain" | "workflow" | "unknown";

export interface SubagentUsage {
	input?: number;
	output?: number;
	/** Total tokens as reported by the backend (no double counting of cache). */
	total?: number;
	costUsd?: number;
}

export interface SubagentActivity {
	/** Tool currently running in the child, e.g. "read". */
	tool?: string;
	/** Display string of its arguments, e.g. "src/api/client.ts" (may be truncated by the backend). */
	args?: string;
	startedAt?: number;
}

/**
 * Operations the RC can perform right now for a run/child. Only these may be shown in the app.
 * - steer / follow_up: send text to a running pi-subagents child (index-targeted).
 * - interrupt: pause the whole pi-subagents run (resumable).
 * - resume: restart a paused/finished pi-subagents child with a message; starts a NEW run (`resumedAs`).
 * - stop: stop the whole background run. stop_child: stop one pending/running child of a background run.
 * - abort_parent: official example only — aborts the parent Pi turn, which stops every child.
 */
export type SubagentAction = "steer" | "follow_up" | "interrupt" | "resume" | "stop" | "stop_child" | "abort_parent";

export interface SubagentChild {
	/** Stable within the run (backend child id such as "step:0", or the index). */
	id: string;
	index: number;
	agent: string;
	/** Short human title (e.g. from the pi-subagents session name), without the agent prefix. */
	title?: string;
	state: SubagentState;
	model?: string;
	thinking?: string;
	startedAt?: number;
	endedAt?: number;
	activity?: SubagentActivity;
	usage?: SubagentUsage;
	error?: string;
	exitCode?: number | null;
	/** Question text while `waiting`, when readable. */
	question?: string;
	/** Whether `subagent_transcript` can return the child's work record. */
	hasTranscript: boolean;
	/** Child-scoped actions (steer, follow_up, stop_child, resume). */
	actions: SubagentAction[];
}

export interface SubagentRun {
	/** RC key: pi-subagents runId, or `tool:<toolCallId>` for runs only known through a tool call. */
	id: string;
	backend: SubagentBackend;
	/** Keeps running after the parent turn ends (pi-subagents async). */
	background: boolean;
	mode: SubagentMode;
	/** Parent tool call that started (or launched) the run; links the chat tool row to the run. */
	toolCallId?: string;
	state: SubagentState;
	startedAt?: number;
	updatedAt?: number;
	endedAt?: number;
	/** Chain progress (0-based index). */
	stage?: { index: number; count: number };
	children: SubagentChild[];
	usage?: SubagentUsage;
	error?: string;
	/** Run this one was resumed from / was resumed into (pi-subagents `resume` creates a new run). */
	resumedFrom?: string;
	resumedAs?: string;
	/** Run-scoped actions (interrupt, stop, abort_parent). */
	actions: SubagentAction[];
}

export interface SubagentsState {
	runs: SubagentRun[];
	/** Backends seen in this Pi, with the version when known. `supported: false` → app shows plain tool rows only. */
	backends: { backend: SubagentBackend; version?: string; supported: boolean }[];
}

/** Counts for the drawer (host InstanceSummary / InstanceMeta). */
export interface SubagentCounts {
	/** queued / running / waiting / stopping children. */
	active: number;
	waiting: number;
	paused: number;
	failed: number;
}

export interface SubagentTranscript {
	/** Parent's request to the child, unredacted when available. */
	task?: string;
	/** Child messages normalized like the main transcript (initial task excluded). Message granularity, not token streaming. */
	items: TranscriptItem[];
	/** Opaque; pass back to get only newer items. */
	cursor: string;
	/** Older records were dropped by the backend or the RC size limit. */
	truncated?: boolean;
}

const ACTIVE: ReadonlySet<SubagentState> = new Set(["queued", "running", "waiting", "stopping"]);

export function isSubagentActive(state: SubagentState): boolean {
	return ACTIVE.has(state);
}

export function countSubagents(runs: readonly SubagentRun[]): SubagentCounts {
	const counts: SubagentCounts = { active: 0, waiting: 0, paused: 0, failed: 0 };
	for (const run of runs) {
		const children = run.children.length > 0 ? run.children : [{ state: run.state }];
		for (const child of children) {
			if (child.state === "waiting") counts.waiting++;
			if (isSubagentActive(child.state)) counts.active++;
			else if (child.state === "paused") counts.paused++;
			else if (child.state === "failed") counts.failed++;
		}
	}
	return counts;
}
