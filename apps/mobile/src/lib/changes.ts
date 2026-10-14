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
	/** Lexically normalized POSIX identity, separate from the first-seen display name. */
	pathKey: string;
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
export const NOTE_CONCURRENT = "同時に複数の変更があったため差分を表示できません。書き込んだ内容を表示しています";

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

/** POSIX lexical normalization only; the app cannot resolve server-side symlinks. */
function normalizePath(path: string): string {
	const absolute = path.startsWith("/");
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (!part || part === ".") continue;
		if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
		else if (part !== ".." || !absolute) parts.push(part);
	}
	return `${absolute ? "/" : ""}${parts.join("/")}` || ".";
}

function pathKey(path: string, cwd: string | null): string {
	const p = path.replace(/^@/, "");
	// Pi expands `~` to a home directory the app doesn't know: keep such paths verbatim so `~/../a.ts` never
	// collapses onto a cwd-relative `a.ts`, and keep relative keys from ever starting with `~`.
	if (p === "~" || p.startsWith("~/")) return p;
	const base = cwd ? normalizePath(cwd) : null;
	const key = displayPath(normalizePath(base && !p.startsWith("/") ? `${base}/${p}` : p), base);
	return key === "~" || key.startsWith("~/") ? `./${key}` : key;
}

// Transcript entries and arrays are immutable in the reducer. Weak keys release old sessions/snapshots.
const pieceCache = new WeakMap<
	ToolResult,
	{ toolName: string; args: unknown; cwd: string | null; piece: ChangePiece | null }
>();
const resultCache = new WeakMap<readonly TranscriptItem[], Map<string, ToolResult>>();

export function toolResults(items: readonly TranscriptItem[]): ReadonlyMap<string, ToolResult> {
	let results = resultCache.get(items);
	if (!results) {
		results = new Map();
		for (const item of items) if (item.kind === "tool_result") results.set(item.toolCallId, item);
		resultCache.set(items, results);
	}
	return results;
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
	const cached = pieceCache.get(result);
	if (cached && cached.toolName === toolName && cached.args === args && cached.cwd === cwd) return cached.piece;
	const piece = buildChange(toolName, args, result, cwd);
	pieceCache.set(result, { toolName, args, cwd, piece });
	return piece;
}

function buildChange(toolName: "edit" | "write", args: unknown, result: ToolResult, cwd: string | null): ChangePiece {
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
		pathKey: pathKey(rawPath || "（不明なファイル）", cwd),
		// With a concurrent write in the same batch, "did not exist" may describe a state another call changed.
		status: pimate?.existed === false && pimate.omitted !== "concurrent" ? "A" : "M",
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
			note: !pimate ? NOTE_CONTENT_ONLY : pimate.omitted === "concurrent" ? NOTE_CONCURRENT : NOTE_UNREADABLE,
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
	const results = toolResults(items);
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
		let file = files.get(piece.pathKey);
		if (!file) {
			// The first call decides A/M: a file the scope created stays "A" even when edited afterwards.
			file = { path: piece.path, status: piece.status, add: 0, del: 0, counted: false, lines: 0, pieces: [] };
			files.set(piece.pathKey, file);
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

interface ChangeSummary {
	files: FileChange[];
	add: number;
	del: number;
	counted: boolean;
}
const summaryCache = new WeakMap<
	readonly TranscriptItem[],
	{ cwd: string | null; ranges: Map<string, ChangeSummary> }
>();

/** Cached per immutable transcript/range, so text deltas do not regroup every completed turn. */
export function changeSummary(
	items: readonly TranscriptItem[],
	cwd: string | null,
	start = 0,
	end = items.length,
): ChangeSummary {
	let cached = summaryCache.get(items);
	if (!cached || cached.cwd !== cwd) {
		cached = { cwd, ranges: new Map() };
		summaryCache.set(items, cached);
	}
	const key = `${start}:${end}`;
	let summary = cached.ranges.get(key);
	if (!summary) {
		const files = groupByFile(collectChanges(items, cwd, start, end));
		summary = { files, ...totals(files) };
		cached.ranges.set(key, summary);
	}
	return summary;
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
	if (scope === "session") return changeSummary(items, cwd).files;
	const turn = turnRanges(items).find((t) => t.id === turnId);
	return turn ? changeSummary(items, cwd, turn.start, turn.end).files : [];
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
