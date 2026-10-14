/**
 * The chat view of one subscribed Pi instance, rebuilt from Host messages.
 *
 * - `subscribed` is a full resync: everything is replaced (snapshot + history, streaming seeded from the snapshot).
 * - `event`s are ordered deltas (seq increasing, not contiguous). Stale or duplicate seqs are dropped.
 * - Transcript items are deduplicated by entryId (history and live `message_end` share ids).
 * - `session_changed` clears the view; the store then re-subscribes and waits for the next `subscribed`.
 * Pure: no React Native imports, the caller passes `now`.
 */
import type {
	HostMessage,
	InstanceSnapshot,
	InstanceStatus,
	ModelRef,
	SessionRef,
	ThinkingLevel,
	TranscriptItem,
	UIRequest,
} from "@pimate/protocol";
import { contentText } from "./format";

export type ViewPhase = "loading" | "ready" | "resyncing" | "error" | "gone";

export interface ToolState {
	toolCallId: string;
	toolName: string;
	args: unknown;
	status: "running" | "done" | "error";
	/** Latest partial output text (tool_update). */
	partialText?: string;
	/** Local receive time of tool_start. */
	startedAt: number;
	durationMs?: number;
	parentToolCallId?: string;
}

export interface SessionNotice {
	reason: string;
	from?: string;
	to?: string;
}

export interface InstanceView {
	instanceId: string;
	phase: ViewPhase;
	error?: { code: string; message?: string };
	cwd: string | null;
	session: SessionRef | null;
	status: InstanceStatus;
	model: ModelRef | null;
	thinking: ThinkingLevel | null;
	items: TranscriptItem[];
	streaming: { text: string; thinking: string };
	tools: Record<string, ToolState>;
	/** toolCallIds in tool_start order. */
	toolOrder: string[];
	pendingUI: UIRequest[];
	/** A TUI prompt the phone cannot render (ctx.ui.custom etc.). */
	uiPrompt: { kind: string; title?: string } | null;
	seq: number;
	/** Shown at the top of the transcript after the PC switched the conversation. */
	sessionNotice: SessionNotice | null;
	/** Local time the current run was first seen (for the header timer). */
	runningSince: number | null;
}

const EMPTY_STREAMING = { text: "", thinking: "" };

export function createView(instanceId: string): InstanceView {
	return {
		instanceId,
		phase: "loading",
		cwd: null,
		session: null,
		status: "idle",
		model: null,
		thinking: null,
		items: [],
		streaming: EMPTY_STREAMING,
		tools: {},
		toolOrder: [],
		pendingUI: [],
		uiPrompt: null,
		seq: -1,
		sessionNotice: null,
		runningSince: null,
	};
}

/** Keeps the first position of every entryId and the content of its last occurrence. */
export function dedupeItems(items: readonly TranscriptItem[]): TranscriptItem[] {
	const index = new Map<string, number>();
	const out: TranscriptItem[] = [];
	for (const item of items) {
		const i = index.get(item.entryId);
		if (i === undefined) {
			index.set(item.entryId, out.length);
			out.push(item);
		} else out[i] = item;
	}
	return out;
}

function upsertItem(items: readonly TranscriptItem[], item: TranscriptItem): TranscriptItem[] {
	const i = items.findIndex((x) => x.entryId === item.entryId);
	if (i < 0) return [...items, item];
	const next = items.slice();
	next[i] = item;
	return next;
}

function sessionLabel(session: SessionRef | null | undefined): string | undefined {
	return session?.name?.trim() || undefined;
}

function runningSince(prev: InstanceView, status: InstanceStatus, now: number): number | null {
	if (status === "idle") return null;
	return prev.runningSince ?? now;
}

function applySubscribed(
	prev: InstanceView,
	snapshot: InstanceSnapshot,
	history: { session: SessionRef | null; items: TranscriptItem[] },
	now: number,
): InstanceView {
	const session = history.session ?? snapshot.session;
	let sessionNotice = prev.phase === "resyncing" ? prev.sessionNotice : null;
	// A reconnect can land in a different conversation (e.g. /resume on the PC while we were offline).
	if (!sessionNotice && prev.session && session && prev.session.id !== session.id)
		sessionNotice = { reason: "switch", from: sessionLabel(prev.session), to: sessionLabel(session) };
	if (sessionNotice && !sessionNotice.to) sessionNotice = { ...sessionNotice, to: sessionLabel(session) };
	return {
		instanceId: prev.instanceId,
		phase: "ready",
		cwd: snapshot.cwd,
		session,
		status: snapshot.status,
		model: snapshot.model,
		thinking: snapshot.thinking,
		items: dedupeItems(history.items),
		streaming: snapshot.streaming
			? { text: snapshot.streaming.text ?? "", thinking: snapshot.streaming.thinking ?? "" }
			: EMPTY_STREAMING,
		tools: {},
		toolOrder: [],
		pendingUI: snapshot.pendingUI ?? [],
		uiPrompt: null,
		seq: snapshot.seq,
		sessionNotice,
		runningSince: snapshot.status === "idle" ? null : (prev.runningSince ?? now),
	};
}

function finishRunningTools(tools: Record<string, ToolState>): Record<string, ToolState> {
	let changed = false;
	const next: Record<string, ToolState> = {};
	for (const [id, tool] of Object.entries(tools)) {
		if (tool.status === "running") {
			changed = true;
			next[id] = { ...tool, status: "done" };
		} else next[id] = tool;
	}
	return changed ? next : tools;
}

/** Applies one Host message to the view. Messages for other instances are ignored. */
export function reduceView(view: InstanceView, msg: HostMessage, now: number): InstanceView {
	switch (msg.type) {
		case "subscribed":
			if (msg.instanceId !== view.instanceId) return view;
			return applySubscribed(view, msg.snapshot, msg.history, now);
		case "subscribe_error":
			if (msg.instanceId !== view.instanceId) return view;
			return { ...view, phase: "error", error: { code: msg.code, message: msg.message } };
		case "instance_gone":
			if (msg.instanceId !== view.instanceId) return view;
			return { ...view, phase: "gone", streaming: EMPTY_STREAMING, tools: finishRunningTools(view.tools) };
		case "event":
			if (msg.instanceId !== view.instanceId) return view;
			if (view.phase !== "ready") return view;
			if (msg.seq <= view.seq) return view;
			return { ...applyEvent(view, msg.event, now), seq: msg.seq };
		default:
			return view;
	}
}

function applyEvent(view: InstanceView, event: Extract<HostMessage, { type: "event" }>["event"], now: number) {
	switch (event.type) {
		case "status":
			return { ...view, status: event.status, runningSince: runningSince(view, event.status, now) };
		case "session_changed": {
			const showNotice = event.reason !== "startup" && event.reason !== "reload";
			return {
				...view,
				phase: "resyncing" as const,
				session: event.session,
				items: [],
				streaming: EMPTY_STREAMING,
				tools: {},
				toolOrder: [],
				pendingUI: [],
				uiPrompt: null,
				sessionNotice: showNotice
					? { reason: event.reason, from: sessionLabel(view.session), to: sessionLabel(event.session) }
					: null,
			};
		}
		case "session_info":
			return view.session ? { ...view, session: { ...view.session, name: event.name } } : view;
		case "agent_start":
			return view.status === "idle"
				? { ...view, status: "running" as const, runningSince: runningSince(view, "running", now) }
				: view;
		case "agent_settled":
			return { ...view, streaming: EMPTY_STREAMING, tools: finishRunningTools(view.tools) };
		case "text_delta":
			return { ...view, streaming: { ...view.streaming, text: view.streaming.text + event.delta } };
		case "thinking_delta":
			return { ...view, streaming: { ...view.streaming, thinking: view.streaming.thinking + event.delta } };
		case "message_end": {
			const item = event.item;
			const next = { ...view, items: upsertItem(view.items, item) };
			if (item.kind === "assistant") next.streaming = EMPTY_STREAMING;
			if (item.kind === "tool_result") {
				const tool = view.tools[item.toolCallId];
				if (tool) {
					const status: ToolState["status"] = item.isError ? "error" : "done";
					next.tools = { ...view.tools, [item.toolCallId]: { ...tool, status } };
				}
			}
			return next;
		}
		case "tool_start": {
			const exists = !!view.tools[event.toolCallId];
			return {
				...view,
				tools: {
					...view.tools,
					[event.toolCallId]: {
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						args: event.args,
						status: "running" as const,
						startedAt: now,
						parentToolCallId: event.parentToolCallId,
					},
				},
				toolOrder: exists ? view.toolOrder : [...view.toolOrder, event.toolCallId],
			};
		}
		case "tool_update": {
			const tool = view.tools[event.toolCallId];
			if (!tool) return view;
			return {
				...view,
				tools: { ...view.tools, [event.toolCallId]: { ...tool, partialText: contentText(event.partial) } },
			};
		}
		case "tool_end": {
			const tool = view.tools[event.toolCallId];
			if (!tool) return view;
			const status: ToolState["status"] = event.isError ? "error" : "done";
			return {
				...view,
				tools: { ...view.tools, [event.toolCallId]: { ...tool, status, durationMs: event.durationMs } },
			};
		}
		case "model":
			return { ...view, model: event.model };
		case "thinking":
			return { ...view, thinking: event.level };
		case "ui_request":
			return {
				...view,
				pendingUI: [...view.pendingUI.filter((r) => r.requestId !== event.request.requestId), event.request],
			};
		case "ui_request_end":
			return { ...view, pendingUI: view.pendingUI.filter((r) => r.requestId !== event.requestId) };
		case "ui_prompt":
			return { ...view, uiPrompt: event.phase === "start" ? { kind: event.kind, title: event.title } : null };
		default:
			// user_input, notify, session_op_done, compact_*, bus and unknown events: not shown in M1.
			return view;
	}
}

/** User entryIds currently in the view (used to recognise a newly delivered message). */
export function userEntryIds(view: InstanceView): string[] {
	return view.items.filter((i) => i.kind === "user").map((i) => i.entryId);
}

/** Finds a user message with `text` that is not one of `known` (i.e. it arrived after we sent it). */
export function findDeliveredUserItem(view: InstanceView, text: string, known: readonly string[]): boolean {
	const target = text.trim();
	return view.items.some((i) => i.kind === "user" && !known.includes(i.entryId) && i.text.trim() === target);
}
