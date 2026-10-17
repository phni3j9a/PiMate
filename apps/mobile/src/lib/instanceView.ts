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
	ContextInfo,
	HostMessage,
	InstanceSnapshot,
	InstanceStatus,
	ModelRef,
	SessionRef,
	SubagentsState,
	SubscriptionQuota,
	ThinkingLevel,
	TranscriptItem,
	UIRequest,
} from "@pimate/protocol";
import { type PromptImage, samePromptImages } from "@pimate/protocol";
import { contentText } from "./format";
import { clearFinishedWatch, normalizeState, upsertRun, watchRuns } from "./subagents";

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
	/** The phone started the switch (session sheet), not the PC. */
	byPhone?: boolean;
	from?: string;
	to?: string;
}

/** A dialog that ended without the phone's answer, shown after the transcript item it followed. */
export interface UINote {
	requestId: string;
	afterEntryId: string | null;
	text: string;
}

export interface InstanceView {
	instanceId: string;
	phase: ViewPhase;
	promptImages?: boolean;
	sessionTree?: boolean;
	slashCommands?: boolean;
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
	uiNotes: UINote[];
	context: ContextInfo | null;
	/** Subscription allowances this Pi has seen. null: the RC predates quota reporting. */
	quotas: SubscriptionQuota[] | null;
	seq: number;
	/** Shown at the top of the transcript after the PC switched the conversation. */
	sessionNotice: SessionNotice | null;
	/** Local time the current run was first seen (for the header timer). */
	runningSince: number | null;
	/**
	 * An agent run (turn) is in progress. Unlike `status`, a dialog opened by an extension command outside a turn
	 * ("waiting_input") does not count: there is nothing to stop and the last turn is complete.
	 */
	agentActive: boolean;
	/**
	 * How long the model thought, per assistant entryId. Only measurable while watching live (the session file
	 * has no timing), so history shows "考えた" without seconds.
	 */
	thinkingMs: Record<string, number>;
	/** Per-user-entry elapsed time, only for turns observed live through agent_settled. */
	turnMs: Record<string, number>;
	turnClock: { since: number; userEntryId: string | null } | null;
	/** Live thinking of the message being streamed: first thinking delta, and the first output after it. */
	thinkingClock: { since: number; until: number | null } | null;
	/** Subagent runs (M4). Empty when the RC knows no supported subagent extension. */
	subagents: SubagentsState;
	/**
	 * Runs seen active since the last user prompt: the summary line above the composer stays for them after they
	 * finish, until the next prompt.
	 */
	subagentWatch: string[];
}

const EMPTY_STREAMING = { text: "", thinking: "" };
const NO_SUBAGENTS: SubagentsState = { runs: [], backends: [] };

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
		uiNotes: [],
		context: null,
		quotas: null,
		seq: -1,
		sessionNotice: null,
		runningSince: null,
		agentActive: false,
		thinkingMs: {},
		turnMs: {},
		turnClock: null,
		thinkingClock: null,
		subagents: NO_SUBAGENTS,
		subagentWatch: [],
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

/** How an unnamed conversation is called: its first user message (as in the past-sessions list). */
export function conversationLabel(
	session: SessionRef | null | undefined,
	items: readonly TranscriptItem[],
): string | undefined {
	const named = sessionLabel(session);
	if (named) return named;
	const first = items.find((i) => i.kind === "user");
	const text = first?.kind === "user" ? first.text.replace(/\s+/g, " ").trim() : "";
	if (!text) return undefined;
	return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

function runningSince(prev: InstanceView, status: InstanceStatus, now: number): number | null {
	if (status === "idle") return null;
	return prev.runningSince ?? now;
}

/**
 * Prefer the explicit run flag. For older RCs only, infer an open turn from the transcript.
 */
function activeFromSnapshot(snapshot: InstanceSnapshot, items: readonly TranscriptItem[]): boolean {
	if (snapshot.agentActive !== undefined) return snapshot.agentActive;
	if (snapshot.status !== "waiting_input") return snapshot.status === "running";
	if (snapshot.streaming?.text || snapshot.streaming?.thinking) return true;
	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i]!;
		if (item.kind === "other") continue;
		return item.kind !== "assistant" || item.stopReason === "toolUse";
	}
	return false;
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
		sessionNotice = { reason: "switch", from: conversationLabel(prev.session, prev.items) };
	if (sessionNotice && !sessionNotice.to)
		sessionNotice = { ...sessionNotice, to: conversationLabel(session, history.items) };
	return {
		instanceId: prev.instanceId,
		phase: "ready",
		cwd: snapshot.cwd,
		session,
		status: snapshot.status,
		promptImages: snapshot.promptImages === true,
		sessionTree: snapshot.sessionTree === true,
		slashCommands: snapshot.slashCommands === true,
		model: snapshot.model,
		thinking: snapshot.thinking,
		items: dedupeItems(history.items),
		streaming: snapshot.streaming
			? { text: snapshot.streaming.text ?? "", thinking: snapshot.streaming.thinking ?? "" }
			: EMPTY_STREAMING,
		tools: {},
		toolOrder: [],
		pendingUI: snapshot.pendingUI ?? [],
		uiPrompt: snapshot.pcPrompt ? { kind: snapshot.pcPrompt.kind, title: snapshot.pcPrompt.title } : null,
		uiNotes: [],
		context: snapshot.context ?? null,
		quotas: snapshot.quotas ?? null,
		seq: snapshot.seq,
		sessionNotice,
		runningSince: snapshot.status === "idle" ? null : (prev.runningSince ?? now),
		agentActive: activeFromSnapshot(snapshot, history.items),
		// Measured durations stay valid for the same conversation (reconnects); a joined stream is not measured.
		thinkingMs: prev.session?.id === session?.id ? prev.thinkingMs : {},
		turnMs: prev.session?.id === session?.id ? prev.turnMs : {},
		turnClock: null,
		thinkingClock: null,
		...withSubagents(prev.subagentWatch, snapshot.subagents ? normalizeState(snapshot.subagents) : NO_SUBAGENTS),
	};
}

function withSubagents(watch: string[], subagents: SubagentsState) {
	return { subagents, subagentWatch: watchRuns(watch, subagents.runs) };
}

function stopClock(clock: InstanceView["thinkingClock"], now: number): InstanceView["thinkingClock"] {
	return clock && clock.until === null ? { ...clock, until: now } : clock;
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
			// Its questions can no longer be answered anywhere.
			return {
				...view,
				phase: "gone",
				streaming: EMPTY_STREAMING,
				tools: finishRunningTools(view.tools),
				pendingUI: [],
				uiPrompt: null,
			};
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
			return {
				...view,
				status: event.status,
				runningSince: runningSince(view, event.status, now),
				agentActive: event.status === "waiting_input" ? view.agentActive : event.status === "running",
			};
		case "session_changed": {
			const showNotice = event.reason !== "startup" && event.reason !== "reload" && event.reason !== "tree";
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
				uiNotes: [],
				thinkingMs: {},
				turnMs: {},
				turnClock: null,
				thinkingClock: null,
				sessionNotice: showNotice
					? { reason: event.reason, from: conversationLabel(view.session, view.items), to: sessionLabel(event.session) }
					: null,
			};
		}
		case "session_info":
			return view.session ? { ...view, session: { ...view.session, name: event.name } } : view;
		case "agent_start":
			return {
				...view,
				status: view.status === "idle" ? ("running" as const) : view.status,
				runningSince: runningSince(view, "running", now),
				agentActive: true,
				turnClock: view.turnClock ?? { since: now, userEntryId: null },
			};
		case "agent_settled":
			return {
				...view,
				turnMs: view.turnClock?.userEntryId
					? { ...view.turnMs, [view.turnClock.userEntryId]: Math.max(0, now - view.turnClock.since) }
					: view.turnMs,
				turnClock: null,
				streaming: EMPTY_STREAMING,
				tools: finishRunningTools(view.tools),
				agentActive: false,
				thinkingClock: null,
			};
		case "text_delta":
			return {
				...view,
				streaming: { ...view.streaming, text: view.streaming.text + event.delta },
				thinkingClock: stopClock(view.thinkingClock, now),
			};
		case "thinking_delta":
			return {
				...view,
				streaming: { ...view.streaming, thinking: view.streaming.thinking + event.delta },
				// Only a stream seen from its start is timed.
				thinkingClock:
					view.thinkingClock ?? (view.streaming.thinking || view.streaming.text ? null : { since: now, until: null }),
			};
		case "message_end": {
			const item = event.item;
			const next = { ...view, items: upsertItem(view.items, item) };
			// A new prompt ends the summary of subagents that finished before it.
			if (item.kind === "user" && !view.items.some((i) => i.entryId === item.entryId))
				next.subagentWatch = clearFinishedWatch(view.subagentWatch, view.subagents.runs);
			// Use one local clock, not the server's request-start timestamps. A queued user starts a new scope.
			if (item.kind === "user" && view.turnClock) next.turnClock = { since: now, userEntryId: item.entryId };
			if (item.kind === "assistant") {
				next.streaming = EMPTY_STREAMING;
				const clock = view.thinkingClock;
				if (clock && item.thinking?.trim())
					next.thinkingMs = { ...view.thinkingMs, [item.entryId]: (clock.until ?? now) - clock.since };
				next.thinkingClock = null;
			}
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
		case "ui_request": {
			const req = event.request;
			// The TUI shows the same dialog; the phone can answer it, so it is not a "PC only" prompt.
			const mirrored = view.uiPrompt && matchesPrompt(req, view.uiPrompt);
			return {
				...view,
				pendingUI: [...view.pendingUI.filter((r) => r.requestId !== req.requestId), req],
				uiPrompt: mirrored ? null : view.uiPrompt,
			};
		}
		case "ui_request_end": {
			const req = view.pendingUI.find((r) => r.requestId === event.requestId);
			if (!req) return view;
			const text = event.by === "tui" ? "PC で回答されました" : event.by === "error" ? "質問は取り消されました" : null;
			const note: UINote | null = text
				? { requestId: req.requestId, afterEntryId: view.items.at(-1)?.entryId ?? null, text: `${text}：${req.title}` }
				: null;
			return {
				...view,
				pendingUI: view.pendingUI.filter((r) => r !== req),
				uiNotes: note ? [...view.uiNotes, note].slice(-5) : view.uiNotes,
			};
		}
		case "ui_prompt":
			if (event.phase === "end") return view.uiPrompt ? { ...view, uiPrompt: null } : view;
			if (view.pendingUI.some((r) => matchesPrompt(r, event))) return view;
			return { ...view, uiPrompt: { kind: event.kind, title: event.title } };
		case "context":
			return { ...view, context: event.context };
		case "quota":
			return {
				...view,
				quotas: [...(view.quotas ?? []).filter((q) => q.source !== event.quota.source), event.quota],
			};
		case "subagent_run":
			return { ...view, ...withSubagents(view.subagentWatch, upsertRun(view.subagents, event.run)) };
		case "subagents_reset":
			return { ...view, ...withSubagents(view.subagentWatch, normalizeState(event.state)) };
		default:
			// user_input, notify, session_op_done, compact_* (handled by the store), bus and unknown events.
			return view;
	}
}

function matchesPrompt(req: UIRequest, prompt: { kind: string; title?: string }): boolean {
	return req.kind === prompt.kind && (prompt.title === undefined || req.title === prompt.title);
}

/** User entryIds currently in the view (used to recognise a newly delivered message). */
export function userEntryIds(view: InstanceView): string[] {
	return view.items.filter((i) => i.kind === "user").map((i) => i.entryId);
}

/** Finds a user message with `text` that is not one of `known` (i.e. it arrived after we sent it). */
export function findDeliveredUserItem(
	view: InstanceView,
	text: string,
	known: readonly string[],
	images: readonly PromptImage[] = [],
): boolean {
	const target = text.trim();
	return view.items.some(
		(i) =>
			i.kind === "user" &&
			!known.includes(i.entryId) &&
			i.text.trim() === target &&
			(i.imageCount ?? i.images?.length ?? 0) === images.length &&
			samePromptImages(i.images, images),
	);
}
