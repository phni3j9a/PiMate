/**
 * Flattens an InstanceView into display rows for the chat list (pure, no React Native imports).
 * Tool calls are joined with their results and live state; spacing follows docs/design/html/Main.html.
 */
import type { TranscriptItem, UIRequest } from "@pimate/protocol";
import { lineCount, seconds, toolSubject, usageLine } from "./format";
import type { InstanceView, SessionNotice, ToolState } from "./instanceView";

export type ToolRowState = "running" | "done" | "error";

export type Row =
	| ({ kind: "sessionNotice"; key: string } & SessionNotice)
	| { kind: "user"; key: string; text: string }
	| { kind: "thinking"; key: string; text: string; live: boolean }
	| { kind: "text"; key: string; text: string; live: boolean }
	| {
			kind: "tool";
			key: string;
			toolCallId: string;
			name: string;
			subject: string;
			state: ToolRowState;
			/** Result text, or the partial output while running. */
			output: string;
			truncated: boolean;
			/** Right-hand meta for finished tools (e.g. `42 行`, `3秒`). Running tools show a live timer instead. */
			meta: string | null;
			startedAt: number | null;
	  }
	| { kind: "meta"; key: string; text: string }
	| { kind: "error"; key: string; text: string }
	| { kind: "note"; key: string; text: string }
	/** A question from Pi, answered inline (docs/design Chat-Waiting). */
	| { kind: "dialog"; key: string; request: UIRequest }
	/** A TUI screen the phone cannot show (docs/design Chat-Attach). */
	| { kind: "pcPrompt"; key: string; promptKind: string; title: string | null };

export type SpacedRow = Row & { marginTop: number };

type ToolResult = Extract<TranscriptItem, { kind: "tool_result" }>;

function toolRow(
	id: string,
	name: string,
	args: unknown,
	result: ToolResult | undefined,
	live: ToolState | undefined,
	viewRunning: boolean,
): Row {
	let state: ToolRowState;
	if (result) state = result.isError ? "error" : "done";
	else if (live) state = live.status;
	// A tool call from history without a result is still running only while the instance is working.
	else state = viewRunning ? "running" : "done";
	const output = result ? result.text : (live?.partialText ?? "");
	let meta: string | null = null;
	if (state === "error") meta = "エラー";
	else if (state === "done") {
		if (name === "read" && result) meta = `${lineCount(result.text)} 行`;
		else if (live?.durationMs !== undefined && live.durationMs >= 1000) meta = seconds(live.durationMs);
	}
	return {
		kind: "tool",
		key: `tool:${id}`,
		toolCallId: id,
		name: name || live?.toolName || "tool",
		subject: toolSubject(name, args ?? live?.args),
		state,
		output,
		truncated: !!result?.truncated,
		meta,
		startedAt: state === "running" ? (live?.startedAt ?? null) : null,
	};
}

export function buildRows(view: InstanceView): Row[] {
	const rows: Row[] = [];
	if (view.sessionNotice) rows.push({ kind: "sessionNotice", key: "session-notice", ...view.sessionNotice });

	const results = new Map<string, ToolResult>();
	for (const item of view.items) if (item.kind === "tool_result") results.set(item.toolCallId, item);
	const shownTools = new Set<string>();
	const viewRunning = view.status !== "idle" && view.phase === "ready";
	const entryIds = new Set(view.items.map((i) => i.entryId));
	const notesAfter = (entryId: string | null) => {
		for (const note of view.uiNotes)
			if (note.afterEntryId === entryId || (entryId === "" && note.afterEntryId && !entryIds.has(note.afterEntryId)))
				rows.push({ kind: "note", key: `ui-note:${note.requestId}`, text: note.text });
	};
	notesAfter(null);

	for (const item of view.items) {
		switch (item.kind) {
			case "user":
				rows.push({ kind: "user", key: item.entryId, text: item.text });
				break;
			case "assistant": {
				if (item.thinking?.trim())
					rows.push({ kind: "thinking", key: `${item.entryId}:thinking`, text: item.thinking, live: false });
				if (item.text.trim()) rows.push({ kind: "text", key: `${item.entryId}:text`, text: item.text, live: false });
				for (const call of item.toolCalls) {
					shownTools.add(call.id);
					rows.push(toolRow(call.id, call.name, call.args, results.get(call.id), view.tools[call.id], viewRunning));
				}
				// A stop is the user's choice, not a failure. Pi 1.2 records a stop during a tool call as
				// stopReason "error" + "This operation was aborted", so the message is matched too.
				if (item.stopReason === "aborted" || /\b(operation|request) was aborted\b/i.test(item.errorMessage ?? ""))
					rows.push({ kind: "note", key: `${item.entryId}:aborted`, text: "中断しました" });
				else if (item.errorMessage) rows.push({ kind: "error", key: `${item.entryId}:error`, text: item.errorMessage });
				if (item.text.trim() && item.stopReason !== "toolUse") {
					const line = usageLine(item.model, item.usage);
					if (line) rows.push({ kind: "meta", key: `${item.entryId}:meta`, text: line });
				}
				break;
			}
			case "tool_result":
				if (!shownTools.has(item.toolCallId)) {
					shownTools.add(item.toolCallId);
					rows.push(toolRow(item.toolCallId, item.toolName, undefined, item, view.tools[item.toolCallId], viewRunning));
				}
				break;
			case "other": {
				const text = item.text?.trim() ? `${item.label}: ${item.text.trim().split("\n")[0]}` : item.label;
				rows.push({ kind: "note", key: item.entryId, text: text.length > 160 ? `${text.slice(0, 160)}…` : text });
				break;
			}
		}
		if (view.uiNotes.length) notesAfter(item.entryId);
	}
	if (view.uiNotes.length) notesAfter("");

	// Live tools whose assistant message has not been seen (e.g. joined mid-turn). Nested subagent tools are skipped.
	for (const id of view.toolOrder) {
		const live = view.tools[id];
		if (!live || shownTools.has(id) || live.parentToolCallId) continue;
		rows.push(toolRow(id, live.toolName, live.args, results.get(id), live, viewRunning));
	}

	const streaming = view.streaming;
	if (streaming.thinking.trim())
		rows.push({ kind: "thinking", key: "live:thinking", text: streaming.thinking, live: true });
	if (streaming.text) rows.push({ kind: "text", key: "live:text", text: streaming.text, live: true });

	for (const request of view.pendingUI) rows.push({ kind: "dialog", key: `ui:${request.requestId}`, request });
	if (view.uiPrompt)
		rows.push({
			kind: "pcPrompt",
			key: "pc-prompt",
			promptKind: view.uiPrompt.kind,
			title: view.uiPrompt.title ?? null,
		});
	return rows;
}

function gap(prev: Row | undefined, row: Row): number {
	if (!prev) return 0;
	if (prev.kind === "sessionNotice") return 28;
	if (row.kind === "user") return prev.kind === "user" ? 12 : 32;
	if (prev.kind === "user") return row.kind === "text" ? 10 : 12;
	if (row.kind === "meta") return 6;
	if (row.kind === "dialog" || row.kind === "pcPrompt") return 24;
	if (prev.kind === "dialog" || prev.kind === "pcPrompt") return 16;
	const compact = (r: Row) => r.kind === "tool" || r.kind === "thinking";
	if (compact(row)) return compact(prev) ? 0 : 8;
	if (row.kind === "text") return prev.kind === "text" ? 12 : 8;
	return 12;
}

/** Adds the vertical spacing between rows (turns 32, tool rows packed, text 6–12). */
export function spaceRows(rows: readonly Row[]): SpacedRow[] {
	return rows.map((row, i) => ({ ...row, marginTop: gap(rows[i - 1], row) }));
}
