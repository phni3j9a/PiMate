/**
 * PiMate protocol v1.
 *
 * RC (Remote Control Extension, one per Pi process) <-> Host: newline-delimited JSON over a private
 * Unix socket. Host <-> mobile app (M1) reuses the same request/response/event shapes, routed by instanceId.
 *
 * Rules
 * - The snapshot is the source of truth; events are deltas. Each instance numbers its events with `seq`
 *   (monotonic per Pi process). A client that sees a gap, or reconnects, calls `hello` (+ `history`) again.
 * - Mutating requests may carry `expectInstanceId` / `expectSessionId`; RC rejects them on mismatch so a
 *   message never lands in another instance or conversation after /new, /resume or a reconnect.
 * - Nothing is retried automatically. Unknown fields must be ignored; unknown event types skipped.
 */

import type { PromptImage } from "./images.ts";
import type { SubagentAction, SubagentCounts, SubagentRun, SubagentsState, SubagentTranscript } from "./subagents.ts";

export * from "./images.ts";

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------- domain

export type InstanceStatus = "idle" | "running" | "waiting_input";
/** Where the Pi process was started: by the user in a terminal, or by the Host on request from the phone. */
export type Origin = "pc" | "mobile";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface SessionRef {
	id: string;
	file?: string;
	name?: string;
}

export interface ModelRef {
	provider: string;
	id: string;
}

export interface Usage {
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: number;
}

export interface ToolCallRef {
	id: string;
	name: string;
	args: unknown;
}

/**
 * Display-only diff the RC adds to a successful built-in `write` result (`details.pimate`), because Pi's write
 * tool records no details. `patch` is a standard unified diff against the content before the write
 * (`existed: false` = new file). Omitted when the file was too large or not text, or when another write/edit to
 * the same file ran in the same parallel tool batch so the prior content is not exact (`omitted` says why).
 * The edit tool already provides `details.patch` (unified diff) itself.
 */
export interface PimateWriteDetails {
	pimate: {
		kind: "write_diff";
		existed: boolean;
		patch?: string;
		omitted?: "too_large" | "binary" | "unreadable" | "concurrent";
	};
}

/** One entry of the current session branch, normalized for display. */
export type TranscriptItem =
	| { kind: "user"; entryId: string; text: string; images?: PromptImage[]; imageCount?: number; timestamp?: number }
	| {
			kind: "assistant";
			entryId: string;
			text: string;
			thinking?: string;
			toolCalls: ToolCallRef[];
			model?: ModelRef;
			usage?: Usage;
			/** Pi's stop reason. RC normalizes an aborted turn (Pi 1.2 records it as "error") to "aborted". */
			stopReason?: string;
			errorMessage?: string;
			timestamp?: number;
	  }
	| {
			kind: "tool_result";
			entryId: string;
			toolCallId: string;
			toolName: string;
			/** Text content, truncated by RC (see `truncated`). */
			text: string;
			truncated?: boolean;
			isError: boolean;
			details?: unknown;
			/** RC omitted details because their serialized JSON exceeds 256 KiB or cannot be serialized. */
			detailsOmitted?: boolean;
			timestamp?: number;
	  }
	/** Compaction summaries, branch summaries, custom messages etc. shown as a single line. */
	| { kind: "other"; entryId: string; label: string; text?: string; timestamp?: number };

export type UIRequestKind = "select" | "confirm" | "input" | "editor";

/** A dialog opened by Pi or any extension through ctx.ui, answerable from the phone. */
export interface UIRequest {
	requestId: string;
	kind: UIRequestKind;
	title: string;
	message?: string;
	options?: string[];
	placeholder?: string;
	/** editor: the TUI editor stays open after a remote answer (Pi's editor() has no AbortSignal). */
	tuiStaysOpen?: boolean;
}

/** Context window usage (ctx.getContextUsage()). `tokens`/`percent` are null right after compaction. */
export interface ContextInfo {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

/** A TUI-only prompt (ctx.ui.custom() or Pi's own selectors) the phone cannot answer: "needs the PC". */
export interface PcPrompt {
	kind: string;
	title?: string;
}

/** One selectable model (ctx.modelRegistry, models with configured auth only). */
export interface ModelInfo {
	provider: string;
	id: string;
	name: string;
	contextWindow?: number;
	/** Thinking levels this model accepts; ["off"] for non-reasoning models. */
	thinkingLevels: ThinkingLevel[];
}

/** A saved session of the instance's cwd (SessionManager.list). */
export interface SessionListItem {
	id: string;
	/** Session file; pass as `session_op` `switch` arg. */
	path: string;
	name?: string;
	firstMessage: string;
	messageCount: number;
	created: number;
	modified: number;
	/** The instance's current session. */
	current: boolean;
}

/** Bounded, display-only session tree. parentId skips hidden tool/state entries. */
export interface SessionTreeItem {
	id: string;
	parentId: string | null;
	kind: string;
	preview: string;
	label?: string;
	timestamp?: number;
	onBranch: boolean;
	isCurrent: boolean;
	isLeaf: boolean;
}

export interface SessionTree {
	nodes: SessionTreeItem[];
	leafId: string | null;
	truncated: boolean;
}

export interface InstanceSnapshot {
	/** PiMate package version; absent on pre-M5 RCs. */
	version?: string;
	protocol: number;
	instanceId: string;
	pid: number;
	cwd: string;
	origin: Origin;
	/** abduco session name when started by the Host; null for a Pi started directly in a terminal. */
	abducoSession: string | null;
	startedAt: number;
	session: SessionRef | null;
	status: InstanceStatus;
	/** A Pi run is between agent_start and agent_settled, including extension dialogs after agent_end. */
	agentActive?: boolean;
	/** Explicit capability: older RCs ignore unknown prompt fields. Never send images without this. */
	promptImages?: boolean;
	/** Session tree read, navigation and labels. Absent on older RCs. */
	sessionTree?: boolean;
	/** RC command discovery, expansion and explicit command acknowledgements. */
	slashCommands?: boolean;
	model: ModelRef | null;
	thinking: ThinkingLevel | null;
	pendingUI: UIRequest[];
	/** TUI-only prompt currently open on the PC, if any. */
	pcPrompt?: PcPrompt | null;
	context?: ContextInfo | null;
	/** Last event seq emitted before this snapshot was taken. */
	seq: number;
	/** Assistant output streamed so far in the current, not yet finished message (for late subscribers). */
	streaming?: { text: string; thinking: string };
	piVersion?: string;
	/** Subagent runs of the current session (M4). Absent from older RCs. */
	subagents?: SubagentsState;
}

/** Discovery file `<runDir>/<instanceId>.json` written by RC (0600). The socket is `<runDir>/<instanceId>.sock`. */
export interface InstanceMeta {
	version?: string;
	protocol: number;
	instanceId: string;
	pid: number;
	cwd: string;
	origin: Origin;
	abducoSession: string | null;
	startedAt: number;
	session: SessionRef | null;
	status: InstanceStatus;
	updatedAt: number;
	subagents?: SubagentCounts;
}

// ---------------------------------------------------------------- events (RC -> client)

export type InstanceEvent =
	| { type: "status"; status: InstanceStatus }
	| { type: "session_changed"; reason: "startup" | "reload" | "new" | "resume" | "fork" | "tree"; session: SessionRef }
	| { type: "session_info"; name?: string }
	| { type: "agent_start" }
	| { type: "agent_settled"; aborted: boolean }
	| { type: "user_input"; text: string; source?: string }
	| { type: "text_delta"; delta: string }
	| { type: "thinking_delta"; delta: string }
	/** A message was appended to the session (same shape as `history` items). */
	| { type: "message_end"; item: TranscriptItem }
	| { type: "tool_start"; toolCallId: string; toolName: string; args: unknown; parentToolCallId?: string }
	| { type: "tool_update"; toolCallId: string; toolName: string; partial: unknown }
	| { type: "tool_end"; toolCallId: string; toolName: string; isError: boolean; durationMs?: number }
	| { type: "model"; model: ModelRef }
	| { type: "thinking"; level: ThinkingLevel }
	| { type: "ui_request"; request: UIRequest }
	| { type: "ui_request_end"; requestId: string; by: "tui" | "remote" | "error" }
	/** Any TUI prompt incl. ctx.ui.custom(), which the phone cannot render ("needs the PC"). */
	| { type: "ui_prompt"; phase: "start" | "end"; kind: string; title?: string }
	| { type: "notify"; message: string; level: "info" | "warning" | "error" }
	/** Sent after each assistant message, compaction, model change and session change. */
	| { type: "context"; context: ContextInfo | null }
	| { type: "session_op_done"; op: SessionOp; cancelled: boolean; error?: string; editorText?: string }
	| { type: "compact_done" }
	| { type: "compact_error"; error: string }
	/** A subagent run was added or changed (replace by id). */
	| { type: "subagent_run"; run: SubagentRun }
	/** Replace the whole subagent state (session change, backend detected, RC resync). */
	| { type: "subagents_reset"; state: SubagentsState }
	/** Raw relay of another extension's pi.events channel (e.g. pi-subagents). */
	| { type: "bus"; channel: string; data: unknown };

export type InstanceEventType = InstanceEvent["type"];

// ---------------------------------------------------------------- methods (client -> RC)

export type SessionOp = "new" | "switch" | "fork" | "reload" | "tree";

export interface CommandInfo {
	name: string;
	description?: string;
	source: string;
}

/** Only a complete leading command token; paths such as /home/x remain ordinary text. */
export function slashCommandName(text: string): string | null {
	const token = text.split(/\s/, 1)[0]!;
	return /^\/[\w:.-]+$/.test(token) ? token.slice(1) : null;
}

export interface RcMethods {
	hello: { params: Record<string, never>; result: { snapshot: InstanceSnapshot } };
	history: { params: Record<string, never>; result: { session: SessionRef | null; items: TranscriptItem[] } };
	/** idle: starts a turn. busy: queued as followUp unless deliverAs is given. Expanded extension commands run immediately and return "command" (no user transcript entry). */
	prompt: {
		params: { text: string; images?: PromptImage[]; deliverAs?: "steer" | "followUp"; expandTemplates?: boolean };
		result: { deliveredAs: "prompt" | "steer" | "followUp" | "command" };
	};
	abort: { params: Record<string, never>; result: Record<string, never> };
	ui_respond: {
		params: { requestId: string; value?: string; confirmed?: boolean; cancelled?: boolean };
		result: Record<string, never>;
	};
	set_thinking: { params: { level: ThinkingLevel }; result: { thinking: ThinkingLevel } };
	set_model: { params: ModelRef; result: { model: ModelRef } };
	compact: { params: { instructions?: string }; result: Record<string, never> };
	/** Pi built-in session commands. Result arrives as a `session_op_done` event. */
	session_op: { params: { op: SessionOp; arg?: string; summarize?: boolean }; result: Record<string, never> };
	/** Current session, with bounded previews and node count. */
	session_tree: { params: Record<string, never>; result: SessionTree };
	/** Empty/omitted label removes the bookmark. */
	set_label: { params: { entryId: string; label?: string }; result: Record<string, never> };
	commands: { params: Record<string, never>; result: { commands: CommandInfo[] } };
	/** `scoped`: Pi's scoped models (`enabledModels` / `/scoped-models`, the PiMate "favorites"); empty = no filter. */
	models: {
		params: Record<string, never>;
		result: { models: ModelInfo[]; current: ModelRef | null; scoped?: ModelRef[] };
	};
	/** Saves the scoped models to Pi's global settings (`enabledModels`); empty = all models. */
	set_scoped_models: { params: { models: ModelRef[] }; result: { scoped: ModelRef[] } };
	/** Saved sessions of the instance's cwd, newest first. */
	sessions: { params: { limit?: number }; result: { sessions: SessionListItem[] } };
	/** Gracefully exit this Pi (ctx.shutdown()). The instance then disappears (`instance_gone`). */
	shutdown: { params: Record<string, never>; result: Record<string, never> };
	/** Relay to pi-subagents' in-process RPC (`subagents:rpc:v1:*`). */
	/** Child work record. `cursor` from a previous reply returns only newer items. */
	subagent_transcript: {
		params: { runId: string; childId: string; cursor?: string };
		result: SubagentTranscript;
	};
	/** Must be listed in the run's/child's `actions`; otherwise rejected with `unsupported`. `text` is required for steer/follow_up/resume. */
	subagent_control: {
		params: { runId: string; childId?: string; action: SubagentAction; text?: string };
		result: { message?: string; newRunId?: string };
	};
	subagents_rpc: {
		params: { method: string; params?: unknown; timeoutMs?: number };
		result: { reply: unknown };
	};
}

export type RcMethod = keyof RcMethods;
export type ParamsOf<M extends RcMethod> = RcMethods[M]["params"];
export type ResultOf<M extends RcMethod> = RcMethods[M]["result"];

// ---------------------------------------------------------------- envelopes

export interface Request<M extends RcMethod = RcMethod> {
	id: string;
	method: M;
	params?: ParamsOf<M>;
	expectInstanceId?: string;
	expectSessionId?: string;
}

export type ErrorCode =
	| "bad_request"
	| "unknown_method"
	| "not_ready"
	| "busy"
	| "instance_mismatch"
	| "session_changed"
	| "no_such_request"
	| "not_found"
	| "timeout"
	| "unsupported"
	| "internal";

export interface ProtocolError {
	code: ErrorCode;
	message?: string;
	/** e.g. `session_changed` carries the current session. */
	data?: unknown;
}

export type Response<M extends RcMethod = RcMethod> =
	| { type: "response"; id: string; ok: true; result: ResultOf<M> }
	| { type: "response"; id: string | null; ok: false; error: ProtocolError };

export interface EventMessage {
	type: "event";
	instanceId: string;
	sessionId: string | null;
	seq: number;
	event: InstanceEvent;
}

export type ServerMessage = Response | EventMessage;

// ---------------------------------------------------------------- NDJSON framing

/** Incremental newline-delimited JSON decoder. Malformed lines are reported, not thrown. */
export class LineDecoder {
	private buf = "";
	private readonly onValue: (value: unknown) => void;
	private readonly onError: (line: string) => void;
	private readonly maxLine: number;

	constructor(
		onValue: (value: unknown) => void,
		onError: (line: string) => void = () => {},
		maxLine = 16 * 1024 * 1024,
	) {
		this.onValue = onValue;
		this.onError = onError;
		this.maxLine = maxLine;
	}

	push(chunk: string): void {
		this.buf += chunk;
		let i = this.buf.indexOf("\n");
		while (i >= 0) {
			const line = this.buf.slice(0, i);
			this.buf = this.buf.slice(i + 1);
			if (line.trim()) {
				let value: unknown;
				let parsed = false;
				try {
					value = JSON.parse(line);
					parsed = true;
				} catch {
					this.onError(line);
				}
				if (parsed) this.onValue(value);
			}
			i = this.buf.indexOf("\n");
		}
		if (this.buf.length > this.maxLine) {
			this.onError(this.buf.slice(0, 200));
			this.buf = "";
		}
	}
}

export function encodeLine(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

export * from "./host.ts";
export * from "./subagents.ts";
