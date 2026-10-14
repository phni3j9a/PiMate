/**
 * Flattens an InstanceView into display rows for the chat list (pure, no React Native imports).
 * Tool calls are joined with their results and live state; spacing follows docs/design/html/Main.html.
 *
 * Completed turns are folded (docs/SPEC.md「UIの方向性」): their thinking, tool rows and intermediate texts carry
 * `fold` and are hidden behind one "18秒 作業 · ツール 4 回" summary row until the user opens it. The final answer,
 * its usage line, errors and notes stay visible. The turn in progress is never folded.
 */
import type { TranscriptItem, UIRequest } from "@pimate/protocol";
import { type ChangePiece, changeOf, collectChanges, groupByFile, totals } from "./changes";
import { lineCount, seconds, toolSubject, usageLine } from "./format";
import type { InstanceView, SessionNotice, ToolState } from "./instanceView";

export type ToolRowState = "running" | "done" | "error";

/** Key of a turn's summary row (also the expand state key). */
export const turnKey = (userEntryId: string) => `turn:${userEntryId}`;

type BaseRow =
	| ({ kind: "sessionNotice"; key: string } & SessionNotice)
	| { kind: "user"; key: string; text: string }
	/** `durationMs`: measured live only (see InstanceView.thinkingMs). */
	| { kind: "thinking"; key: string; text: string; live: boolean; durationMs?: number }
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
			/** What a finished edit/write changed (diff, written content or why it is missing). */
			change: ChangePiece | null;
			/** The turn (user entryId) the call belongs to, for opening the Review screen. */
			turnId: string | null;
	  }
	/** A completed turn folded into one line; `+add −del` opens the Review screen for it. */
	| {
			kind: "turnSummary";
			key: string;
			turnId: string;
			/** User message to the last message of the turn; null when unknown or under a second. */
			durationMs: number | null;
			tools: number;
			/** Files changed by edit/write in the turn. */
			files: number;
			add: number;
			del: number;
			/** Whether add/del come from real diffs (written-content-only changes have no counts). */
			counted: boolean;
	  }
	| { kind: "meta"; key: string; text: string }
	| { kind: "error"; key: string; text: string }
	| { kind: "note"; key: string; text: string }
	/** A question from Pi, answered inline (docs/design Chat-Waiting). */
	| { kind: "dialog"; key: string; request: UIRequest }
	/** A TUI screen the phone cannot show (docs/design Chat-Attach). */
	| { kind: "pcPrompt"; key: string; promptKind: string; title: string | null };

/** `fold`: the turnKey whose summary hides this row while closed. */
export type Row = BaseRow & { fold?: string };

export type SpacedRow = Row & { marginTop: number };

type ToolResult = Extract<TranscriptItem, { kind: "tool_result" }>;

/** `+6 −2` for a diff, `+18` without removals, `12 行` for written content whose previous version is unknown. */
export function changeMeta(change: ChangePiece): string | null {
	if (change.kind === "patch") return change.del ? `+${change.add} −${change.del}` : `+${change.add}`;
	if (change.kind === "content") return `${change.lines} 行`;
	return null;
}

function toolRow(
	id: string,
	name: string,
	args: unknown,
	result: ToolResult | undefined,
	live: ToolState | undefined,
	viewRunning: boolean,
	cwd: string | null,
	turnId: string | null,
): Row {
	let state: ToolRowState;
	if (result) state = result.isError ? "error" : "done";
	else if (live) state = live.status;
	// A tool call from history without a result is still running only while the instance is working.
	else state = viewRunning ? "running" : "done";
	const output = result ? result.text : (live?.partialText ?? "");
	const toolName = name || live?.toolName || "";
	const change = state === "done" ? changeOf(toolName, args ?? live?.args, result, cwd) : null;
	let meta: string | null = null;
	if (state === "error") meta = "エラー";
	else if (state === "done") {
		if (change) meta = changeMeta(change);
		else if (name === "read" && result) meta = `${lineCount(result.text)} 行`;
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
		change,
		turnId,
	};
}

interface TurnInfo {
	id: string;
	/** Row index of the user row; rows of the turn end at rowEnd. */
	rowStart: number;
	rowEnd: number;
	itemStart: number;
	itemEnd: number;
	/** Key of the text row that answers the turn (stays visible when folded). */
	finalText: string | null;
}

function turnDuration(items: readonly TranscriptItem[], turn: TurnInfo): number | null {
	const start = items[turn.itemStart]?.timestamp;
	if (!start) return null;
	let end = 0;
	for (let i = turn.itemStart + 1; i < turn.itemEnd; i++) end = Math.max(end, items[i]!.timestamp ?? 0);
	return end - start >= 1000 ? end - start : null;
}

/** Marks the work rows of completed turns with `fold` and inserts their summary rows. */
function foldTurns(rows: Row[], view: InstanceView, turns: TurnInfo[]): Row[] {
	if (!turns.length) return rows;
	const inProgress = view.agentActive && view.phase === "ready";
	const out: Row[] = [];
	let next = 0;
	turns.forEach((turn, index) => {
		for (; next < turn.rowStart; next++) out.push(rows[next]!);
		const range = rows.slice(turn.rowStart, turn.rowEnd);
		next = turn.rowEnd;
		const tools = range.filter((r) => r.kind === "tool").length;
		// A turn without tool calls has nothing worth folding (a lone "考えた" row stays as it is).
		if ((index === turns.length - 1 && inProgress) || tools === 0) {
			out.push(...range);
			return;
		}
		const key = turnKey(turn.id);
		const changed = groupByFile(collectChanges(view.items, view.cwd, turn.itemStart, turn.itemEnd));
		const changes = totals(changed);
		let summarized = false;
		for (const row of range) {
			const foldable =
				row.kind === "thinking" || row.kind === "tool" || (row.kind === "text" && row.key !== turn.finalText);
			if (!foldable) {
				out.push(row);
				continue;
			}
			if (!summarized) {
				summarized = true;
				out.push({
					kind: "turnSummary",
					key,
					turnId: turn.id,
					durationMs: turnDuration(view.items, turn),
					tools,
					files: changed.length,
					add: changes.add,
					del: changes.del,
					counted: changes.counted,
				});
			}
			out.push({ ...row, fold: key });
		}
	});
	for (; next < rows.length; next++) out.push(rows[next]!);
	return out;
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

	const turns: TurnInfo[] = [];
	const closeTurn = (itemEnd: number) => {
		const last = turns.at(-1);
		if (last && last.rowEnd < 0) {
			last.rowEnd = rows.length;
			last.itemEnd = itemEnd;
		}
	};
	const cwd = view.cwd;
	const turnId = () => turns.at(-1)?.id ?? null;

	view.items.forEach((item, itemIndex) => {
		switch (item.kind) {
			case "user":
				closeTurn(itemIndex);
				turns.push({
					id: item.entryId,
					rowStart: rows.length,
					rowEnd: -1,
					itemStart: itemIndex,
					itemEnd: -1,
					finalText: null,
				});
				rows.push({ kind: "user", key: item.entryId, text: item.text });
				break;
			case "assistant": {
				if (item.thinking?.trim())
					rows.push({
						kind: "thinking",
						key: `${item.entryId}:thinking`,
						text: item.thinking,
						live: false,
						durationMs: view.thinkingMs[item.entryId],
					});
				if (item.text.trim()) {
					rows.push({ kind: "text", key: `${item.entryId}:text`, text: item.text, live: false });
					const turn = turns.at(-1);
					if (turn && item.stopReason !== "toolUse") turn.finalText = `${item.entryId}:text`;
				}
				for (const call of item.toolCalls) {
					shownTools.add(call.id);
					rows.push(
						toolRow(
							call.id,
							call.name,
							call.args,
							results.get(call.id),
							view.tools[call.id],
							viewRunning,
							cwd,
							turnId(),
						),
					);
				}
				// A stop is the user's choice, not a failure. Pi 1.2 records a stop during a tool call as
				// stopReason "error" + "This operation was aborted", so the message is matched too.
				if (item.stopReason === "aborted" || /\b(operation|request) was aborted\b/i.test(item.errorMessage ?? ""))
					rows.push({ kind: "note", key: `${item.entryId}:aborted`, text: "中断しました" });
				else if (item.errorMessage) rows.push({ kind: "error", key: `${item.entryId}:error`, text: item.errorMessage });
				// An aborted message's usage is all zero; a line with only the model name says nothing.
				if (item.text.trim() && item.stopReason !== "toolUse" && item.stopReason !== "aborted") {
					const line = usageLine(item.model, item.usage);
					if (line) rows.push({ kind: "meta", key: `${item.entryId}:meta`, text: line });
				}
				break;
			}
			case "tool_result":
				if (!shownTools.has(item.toolCallId)) {
					shownTools.add(item.toolCallId);
					rows.push(
						toolRow(
							item.toolCallId,
							item.toolName,
							undefined,
							item,
							view.tools[item.toolCallId],
							viewRunning,
							cwd,
							turnId(),
						),
					);
				}
				break;
			case "other": {
				const text = item.text?.trim() ? `${item.label}: ${item.text.trim().split("\n")[0]}` : item.label;
				rows.push({ kind: "note", key: item.entryId, text: text.length > 160 ? `${text.slice(0, 160)}…` : text });
				break;
			}
		}
		if (view.uiNotes.length) notesAfter(item.entryId);
	});
	if (view.uiNotes.length) notesAfter("");
	closeTurn(view.items.length);
	const folded = foldTurns(rows, view, turns);
	if (folded !== rows) rows.splice(0, rows.length, ...folded);

	// Live tools whose assistant message has not been seen (e.g. joined mid-turn). Nested subagent tools are skipped.
	for (const id of view.toolOrder) {
		const live = view.tools[id];
		if (!live || shownTools.has(id) || live.parentToolCallId) continue;
		rows.push(toolRow(id, live.toolName, live.args, results.get(id), live, viewRunning, cwd, turnId()));
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
	if (row.kind === "turnSummary") return prev.kind === "user" ? 10 : 8;
	if (prev.kind === "turnSummary") return row.kind === "text" ? 6 : 4;
	if (prev.kind === "user") return row.kind === "text" ? 10 : 12;
	if (row.kind === "meta") return 6;
	if (row.kind === "dialog" || row.kind === "pcPrompt") return 24;
	if (prev.kind === "dialog" || prev.kind === "pcPrompt") return 16;
	const compact = (r: Row) => r.kind === "tool" || r.kind === "thinking";
	if (compact(row)) return compact(prev) ? 0 : 8;
	if (row.kind === "text") return prev.kind === "text" ? 12 : 8;
	return 12;
}

/** Drops the rows of folded turns that are closed. `isOpen` gets the turnKey. */
export function visibleRows(rows: readonly Row[], isOpen: (turnKey: string) => boolean): Row[] {
	return rows.filter((r) => !r.fold || isOpen(r.fold));
}

/** Adds the vertical spacing between rows (turns 32, tool rows packed, text 6–12). */
export function spaceRows(rows: readonly Row[]): SpacedRow[] {
	return rows.map((row, i) => ({ ...row, marginTop: gap(rows[i - 1], row) }));
}
