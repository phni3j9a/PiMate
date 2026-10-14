/**
 * File changes made by Pi's built-in `edit` / `write` tools, for the tool rows, the turn summary and the Review
 * screen (docs/design/html/Review.html). Pure, no React Native imports.
 *
 * Sources: `edit` results carry `details.patch` (unified diff, Pi itself). `write` results carry
 * `details.pimate` (PimateWriteDetails, added by the RC). Older sessions or a Pi without the RC have no write diff:
 * then the written content (tool call args) is shown as such — the previous content is unknown, so it is neither
 * counted as added lines nor called a new file. Changes made by other tools (bash etc.) are not visible here.
 */
import type { PimateWriteDetails, TranscriptItem } from "@pimate/protocol";
import { type DiffHunk, parseUnifiedDiff } from "./diff";

export type ChangeKind = "patch" | "content" | "omitted";

/** What one edit/write call changed. */
export interface ChangePiece {
	toolCallId: string;
	tool: "edit" | "write";
	/** Display path (relative to the instance's folder when inside it). */
	path: string;
	/** A = the write created the file (RC confirmed it did not exist), M = anything else. */
	status: "A" | "M";
	/** patch: a real diff. content: written content only (previous unknown). omitted: nothing to show. */
	kind: ChangeKind;
	hunks: DiffHunk[];
	/** Counted lines of a real diff (0 for content/omitted). */
	add: number;
	del: number;
	/** The unified diff text as received (patch kind only), for copying. */
	patch: string | null;
	/** Number of written lines (content kind). */
	lines: number;
	/** Why the diff is missing or partial, shown above/instead of the hunks. */
	note: string | null;
}

/** All pieces of one file in a scope, in order. */
export interface FileChange {
	path: string;
	status: "A" | "M";
	add: number;
	del: number;
	/** Whether any piece is a real diff (otherwise add/del are unknown, not zero). */
	counted: boolean;
	/** Written lines of content-only pieces. */
	lines: number;
	pieces: ChangePiece[];
}

export interface TurnRange {
	/** entryId of the user message that starts the turn. */
	id: string;
	/** Item indices: [start, end). */
	start: number;
	end: number;
}

type ToolResult = Extract<TranscriptItem, { kind: "tool_result" }>;

export const NOTE_TOO_LARGE = "差分は大きすぎるため表示できません";
export const NOTE_BINARY = "バイナリファイルのため差分を表示できません";
export const NOTE_NO_DIFF = "差分の情報がありません";
export const NOTE_CONTENT_ONLY = "変更前の内容は分からないため、書き込んだ内容を表示しています";
export const NOTE_UNREADABLE = "変更前の内容を読めなかったため、書き込んだ内容を表示しています";

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** `/home/me/app/src/a.ts` with cwd `/home/me/app` -> `src/a.ts`. */
export function displayPath(path: string, cwd: string | null): string {
	const p = path.replace(/^@/, "");
	if (!cwd) return p;
	const base = cwd.replace(/\/+$/, "");
	return p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p;
}

function writeDetails(details: unknown): PimateWriteDetails["pimate"] | null {
	const p = record(record(details).pimate);
	return p.kind === "write_diff" ? (p as PimateWriteDetails["pimate"]) : null;
}

function contentHunk(content: string): DiffHunk {
	const lines = content.replace(/\n$/, "").split("\n");
	return {
		header: "",
		oldStart: 0,
		oldLines: 0,
		newStart: 1,
		newLines: lines.length,
		lines: lines.map((text, i) => ({ kind: "add" as const, text, oldNo: null, newNo: i + 1 })),
	};
}

/** The change of one finished edit/write call, or null for other tools, failures and unfinished calls. */
export function changeOf(
	toolName: string,
	args: unknown,
	result: ToolResult | undefined,
	cwd: string | null,
): ChangePiece | null {
	if ((toolName !== "edit" && toolName !== "write") || !result || result.isError) return null;
	const a = record(args);
	const details = record(result.details);
	const omittedByRc = (result as { detailsOmitted?: boolean }).detailsOmitted === true;
	const patchText = toolName === "edit" ? details.patch : writeDetails(result.details)?.patch;
	const parsed = typeof patchText === "string" ? parseUnifiedDiff(patchText) : [];
	const rawPath =
		(typeof a.path === "string" && a.path) ||
		(typeof a.file_path === "string" && a.file_path) ||
		parsed[0]?.newPath ||
		parsed[0]?.oldPath ||
		"";
	const pimate = toolName === "write" ? writeDetails(result.details) : null;
	const piece: ChangePiece = {
		toolCallId: result.toolCallId,
		tool: toolName,
		path: displayPath(rawPath || "（不明なファイル）", cwd),
		status: pimate?.existed === false ? "A" : "M",
		kind: "omitted",
		hunks: [],
		add: 0,
		del: 0,
		patch: null,
		lines: 0,
		note: null,
	};
	if (typeof patchText === "string") {
		piece.kind = "patch";
		piece.patch = patchText;
		piece.hunks = parsed.flatMap((f) => f.hunks);
		for (const f of parsed) {
			piece.add += f.add;
			piece.del += f.del;
		}
		return piece;
	}
	if (omittedByRc || pimate?.omitted === "too_large") return { ...piece, note: NOTE_TOO_LARGE };
	if (pimate?.omitted === "binary") return { ...piece, note: NOTE_BINARY };
	if (toolName === "write" && typeof a.content === "string") {
		const hunk = contentHunk(a.content);
		return {
			...piece,
			kind: "content",
			hunks: [hunk],
			lines: hunk.lines.length,
			note: pimate ? NOTE_UNREADABLE : NOTE_CONTENT_ONLY,
		};
	}
	return { ...piece, note: NOTE_NO_DIFF };
}

/** Turns of the transcript: a user message and everything up to the next one. Items before the first are not a turn. */
export function turnRanges(items: readonly TranscriptItem[]): TurnRange[] {
	const turns: TurnRange[] = [];
	items.forEach((item, i) => {
		if (item.kind !== "user") return;
		const last = turns.at(-1);
		if (last) last.end = i;
		turns.push({ id: item.entryId, start: i, end: items.length });
	});
	return turns;
}

/** Edit/write changes of items[start, end), in call order. Results are looked up in all items. */
export function collectChanges(
	items: readonly TranscriptItem[],
	cwd: string | null,
	start = 0,
	end = items.length,
): ChangePiece[] {
	const results = new Map<string, ToolResult>();
	for (const item of items) if (item.kind === "tool_result") results.set(item.toolCallId, item);
	const pieces: ChangePiece[] = [];
	for (let i = start; i < end; i++) {
		const item = items[i]!;
		if (item.kind !== "assistant") continue;
		for (const call of item.toolCalls) {
			const piece = changeOf(call.name, call.args, results.get(call.id), cwd);
			if (piece) pieces.push(piece);
		}
	}
	return pieces;
}

/**
 * Groups pieces by file, keeping first-seen file order and call order within a file.
 *
 * Hunks of several calls to the same file are shown one after another, not merged into a net diff: each patch
 * is relative to the file as it was right before that call, and composing them reliably would need the file
 * contents. The counts are therefore the sum of the calls (a line added then removed counts on both sides).
 */
export function groupByFile(pieces: readonly ChangePiece[]): FileChange[] {
	const files = new Map<string, FileChange>();
	for (const piece of pieces) {
		let file = files.get(piece.path);
		if (!file) {
			// The first call decides A/M: a file the scope created stays "A" even when edited afterwards.
			file = { path: piece.path, status: piece.status, add: 0, del: 0, counted: false, lines: 0, pieces: [] };
			files.set(piece.path, file);
		}
		file.pieces.push(piece);
		file.add += piece.add;
		file.del += piece.del;
		file.lines += piece.lines;
		if (piece.kind === "patch") file.counted = true;
	}
	return [...files.values()];
}

export function totals(files: readonly FileChange[]): { add: number; del: number; counted: boolean } {
	let add = 0;
	let del = 0;
	let counted = false;
	for (const f of files) {
		add += f.add;
		del += f.del;
		counted ||= f.counted;
	}
	return { add, del, counted };
}

/** The unified diffs of the files, concatenated in display order (content-only pieces have none). */
export function combinedPatch(files: readonly FileChange[]): string {
	return files
		.flatMap((f) => f.pieces)
		.filter((p) => p.patch)
		.map((p) => (p.patch!.endsWith("\n") ? p.patch! : `${p.patch}\n`))
		.join("");
}

export type ReviewScope = "turn" | "session";

/** Changes of one turn (by its user entryId) or of the whole loaded transcript. */
export function scopeChanges(
	items: readonly TranscriptItem[],
	cwd: string | null,
	scope: ReviewScope,
	turnId: string | null,
): FileChange[] {
	if (scope === "session") return groupByFile(collectChanges(items, cwd));
	const turn = turnRanges(items).find((t) => t.id === turnId);
	return turn ? groupByFile(collectChanges(items, cwd, turn.start, turn.end)) : [];
}

/** The most recent turn that changed files (the Review screen's "このターン" when opened for the session). */
export function latestChangedTurn(items: readonly TranscriptItem[], cwd: string | null): string | null {
	const turns = turnRanges(items);
	for (let i = turns.length - 1; i >= 0; i--) {
		const t = turns[i]!;
		if (collectChanges(items, cwd, t.start, t.end).length) return t.id;
	}
	return null;
}

/** Short reference for the composer: "このターンの変更（src/greet.ts ほか 2 ファイル）について：". */
export function changeReference(files: readonly FileChange[], scope: ReviewScope): string {
	const what = scope === "turn" ? "このターンの変更" : "このセッションの変更";
	if (!files.length) return `${what}について：`;
	const first = files[0]!.path;
	const rest = files.length - 1;
	return `${what}（${first}${rest > 0 ? ` ほか ${rest} ファイル` : ""}）について：`;
}
