/**
 * A subagent child's work record as chat rows (docs/design/html/Subagent-Detail.html): the same rows as the
 * main chat, never folded, with user messages after the task labeled by who sent them.
 */
import { isSubagentActive, type SubagentAction, type SubagentState, type TranscriptItem } from "@pimate/protocol";
import { createView, dedupeItems } from "./instanceView";
import { buildRows, type SpacedRow, spaceRows } from "./transcriptRows";

const SENT_LABEL: Partial<Record<SubagentAction, string>> = {
	steer: "あなた · 割り込み",
	follow_up: "あなた · 後で伝える",
	resume: "あなた · 続きを依頼",
};

/** Appends newer items (by entryId) to the record; the RC returns only items after the cursor. */
export function mergeTranscript(
	current: readonly TranscriptItem[],
	incoming: readonly TranscriptItem[],
): TranscriptItem[] {
	return incoming.length ? dedupeItems([...current, ...incoming]) : (current as TranscriptItem[]);
}

export function subagentRows(
	items: readonly TranscriptItem[],
	state: SubagentState,
	sent: readonly { text: string; action: SubagentAction }[],
): SpacedRow[] {
	const running = isSubagentActive(state) && state !== "waiting";
	const view = {
		...createView("subagent"),
		phase: "ready" as const,
		items: items as TranscriptItem[],
		status: running ? ("running" as const) : ("idle" as const),
		agentActive: running,
	};
	const used = new Set<number>();
	const rows = buildRows(view, { fold: false }).map((row) => {
		if (row.kind !== "user") return row;
		const index = sent.findIndex((s, i) => !used.has(i) && s.text.trim() === row.text.trim());
		if (index >= 0) used.add(index);
		const caption = index >= 0 ? (SENT_LABEL[sent[index]!.action] ?? "あなた") : "追加の指示";
		return { ...row, caption };
	});
	return spaceRows(rows);
}
