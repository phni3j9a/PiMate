import type { HostMessage, TranscriptItem } from "@pimate/protocol";
import { describe, expect, it, vi } from "vitest";
import {
	changeOf,
	changeReference,
	changeSummary,
	combinedPatch,
	displayPath,
	groupByFile,
	latestChangedTurn,
	NOTE_CONCURRENT,
	NOTE_CONTENT_ONLY,
	NOTE_TOO_LARGE,
	scopeChanges,
	toolResults,
	totals,
} from "../src/lib/changes";
import * as diff from "../src/lib/diff";
import { parseUnifiedDiff } from "../src/lib/diff";
import { createView, type InstanceView, reduceView } from "../src/lib/instanceView";
import { buildRows, visibleRows } from "../src/lib/transcriptRows";

// What Pi's edit tool stores (jsdiff createTwoFilesPatch, FILE_HEADERS_ONLY).
const EDIT_PATCH = [
	"--- src/greet.ts",
	"+++ src/greet.ts",
	"@@ -1,4 +1,5 @@",
	" export function greet(name: string) {",
	"-\treturn 'Hello ' + name;",
	"+\tconst who = name.trim();",
	"+\treturn 'Hello, ' + who;",
	" }",
	" ",
	"@@ -20,2 +21,2 @@ export const x = 1;",
	"--- removed line that looks like a header",
	"+++ added line that looks like a header",
	"\\ No newline at end of file",
	"",
].join("\n");

describe("parseUnifiedDiff", () => {
	it("reads hunks with old/new line numbers and counts", () => {
		const [file, ...rest] = parseUnifiedDiff(EDIT_PATCH);
		expect(rest).toEqual([]);
		expect(file).toMatchObject({ oldPath: "src/greet.ts", newPath: "src/greet.ts", add: 3, del: 2 });
		expect(file!.hunks).toHaveLength(2);
		const [h1, h2] = file!.hunks;
		expect(h1!.lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
			["ctx", 1, 1],
			["del", 2, null],
			["add", null, 2],
			["add", null, 3],
			["ctx", 3, 4],
			["ctx", 4, 5],
		]);
		expect(h2!.header).toBe("@@ -20,2 +21,2 @@ export const x = 1;");
		expect(h2!.lines.map((l) => [l.kind, l.text])).toEqual([
			["del", "-- removed line that looks like a header"],
			["add", "++ added line that looks like a header"],
		]);
		expect(h2!.lines[1]!.noNewline).toBe(true);
	});

	it("splits jsdiff and git patches into files", () => {
		const jsdiff = [
			"Index: a.ts",
			"===================================================================",
			"--- a.ts",
			"+++ a.ts",
			"@@ -0,0 +1,2 @@",
			"+one",
			"+two",
			"Index: b.ts",
			"===================================================================",
			"--- b.ts",
			"+++ b.ts",
			"@@ -1 +1 @@",
			"-x",
			"+y",
		].join("\n");
		expect(parseUnifiedDiff(jsdiff).map((f) => [f.newPath, f.add, f.del])).toEqual([
			["a.ts", 2, 0],
			["b.ts", 1, 1],
		]);
		const git = [
			"diff --git a/new.ts b/new.ts",
			"new file mode 100644",
			"index 0000000..e69de29",
			"--- /dev/null",
			"+++ b/new.ts",
			"@@ -0,0 +1 @@",
			"+hi",
			"diff --git a/img.png b/img.png",
			"Binary files a/img.png and b/img.png differ",
		].join("\n");
		expect(parseUnifiedDiff(git).map((f) => [f.oldPath, f.newPath, f.add])).toEqual([
			[null, "new.ts", 1],
			["img.png", "img.png", 0],
		]);
		expect(parseUnifiedDiff("")).toEqual([]);
	});
});

const result = (
	toolCallId: string,
	toolName: string,
	details?: unknown,
	extra: object = {},
): Extract<TranscriptItem, { kind: "tool_result" }> => ({
	kind: "tool_result",
	entryId: `r-${toolCallId}`,
	toolCallId,
	toolName,
	text: "ok",
	isError: false,
	details,
	...extra,
});
const call = (entryId: string, calls: { id: string; name: string; args: unknown }[], ts?: number): TranscriptItem => ({
	kind: "assistant",
	entryId,
	text: "",
	toolCalls: calls,
	stopReason: "toolUse",
	timestamp: ts,
});
const writePatch = "--- src/new.ts\n+++ src/new.ts\n@@ -0,0 +1,2 @@\n+a\n+b\n";

describe("changes", () => {
	it("reads edit patches, RC write diffs and falls back to written content", () => {
		const edit = changeOf("edit", { path: "/w/src/greet.ts" }, result("e", "edit", { patch: EDIT_PATCH }) as any, "/w");
		expect(edit).toMatchObject({ path: "src/greet.ts", status: "M", kind: "patch", add: 3, del: 2 });
		const created = changeOf(
			"write",
			{ path: "src/new.ts", content: "a\nb\n" },
			result("w", "write", { pimate: { kind: "write_diff", existed: false, patch: writePatch } }) as any,
			"/w",
		);
		expect(created).toMatchObject({ status: "A", kind: "patch", add: 2, del: 0 });
		// Older session: no RC details. Never claim a new file or added lines.
		const old = changeOf("write", { path: "x.md", content: "1\n2\n3\n" }, result("o", "write") as any, null);
		expect(old).toMatchObject({ status: "M", kind: "content", lines: 3, add: 0, note: NOTE_CONTENT_ONLY });
		expect(old!.hunks[0]!.lines.map((l) => l.newNo)).toEqual([1, 2, 3]);
		const big = changeOf(
			"write",
			{ path: "x" },
			result("b", "write", undefined, { detailsOmitted: true }) as any,
			null,
		);
		expect(big).toMatchObject({ kind: "omitted", note: NOTE_TOO_LARGE });
		const tooLarge = changeOf(
			"write",
			{ path: "x", content: "y" },
			result("t", "write", { pimate: { kind: "write_diff", existed: true, omitted: "too_large" } }) as any,
			null,
		);
		expect(tooLarge).toMatchObject({ kind: "omitted", note: NOTE_TOO_LARGE });
		const concurrent = changeOf(
			"write",
			{ path: "x", content: "y\n" },
			result("c", "write", { pimate: { kind: "write_diff", existed: false, omitted: "concurrent" } }) as any,
			null,
		);
		expect(concurrent).toMatchObject({ kind: "content", status: "M", lines: 1, note: NOTE_CONCURRENT });
		expect(changeOf("read", {}, result("r", "read") as any, null)).toBeNull();
		expect(changeOf("edit", {}, { ...(result("f", "edit") as any), isError: true }, null)).toBeNull();
		expect(displayPath("@/w/a.ts", "/w/")).toBe("a.ts");
		expect(displayPath("/other/a.ts", "/w")).toBe("/other/a.ts");
	});

	it.each([null, "/w", "/w/", "/w/nested/..", "/"])(
		"groups path aliases with cwd %s and preserves created status",
		(cwd) => {
			const aliases = ["src/new.ts", "./src/new.ts", "a/../src/new.ts", "src//./new.ts"];
			if (cwd) aliases.push(`${cwd}/src/new.ts`);
			const pieces = aliases.map(
				(path, i) =>
					changeOf(
						i === 0 ? "write" : "edit",
						{ path },
						i === 0
							? result("w", "write", { pimate: { kind: "write_diff", existed: false, patch: writePatch } })
							: result(`e${i}`, "edit", { patch: EDIT_PATCH }),
						cwd,
					)!,
			);
			const files = groupByFile(pieces);
			expect(files).toHaveLength(1);
			expect(files[0]).toMatchObject({ path: "src/new.ts", status: "A" });
			expect(files[0]!.pieces).toHaveLength(aliases.length);
		},
	);

	it("normalizes outside-cwd paths without conflating different roots or losing the display name", () => {
		const piece = (path: string, cwd: string | null = "/w") =>
			changeOf("edit", { path }, result(path, "edit", { patch: EDIT_PATCH }), cwd)!;
		const files = groupByFile([piece("./src/a.ts"), piece("src/a.ts"), piece("/work/src/a.ts")]);
		expect(files.map((f) => f.path)).toEqual(["./src/a.ts", "/work/src/a.ts"]);
		expect(groupByFile([piece("../other/a.ts"), piece("/other/a.ts")])).toHaveLength(1);
		expect(groupByFile([piece("../a.ts", null), piece("a.ts", null)])).toHaveLength(2);
		expect(groupByFile([piece("src/a.ts", null), piece("/w/src/a.ts", null)])).toHaveLength(2);
		// `~` is expanded by Pi to an unknown home: never conflate it with cwd-relative paths.
		expect(groupByFile([piece("a.ts"), piece("~/../a.ts")])).toHaveLength(2);
		expect(groupByFile([piece("~/a.ts"), piece("./~/a.ts")])).toHaveLength(2);
	});

	it("parses each patch once and reuses result indexes/turn summaries across streaming deltas", () => {
		const parse = vi.spyOn(diff, "parseUnifiedDiff");
		try {
			let view: InstanceView = {
				...createView("i"),
				phase: "ready" as const,
				cwd: "/w",
				seq: 0,
				items: [
					{ kind: "user" as const, entryId: "u", text: "go" },
					call("a", [{ id: "e", name: "edit", args: { path: "src/greet.ts" } }]),
					result("e", "edit", { patch: EDIT_PATCH }),
					call("b", [{ id: "w", name: "write", args: { path: "src/new.ts" } }]),
					result("w", "write", { pimate: { kind: "write_diff", existed: false, patch: writePatch } }),
				],
			};
			buildRows(view); // tool row and completed-turn summary share each parsed result
			const summary = changeSummary(view.items, view.cwd);
			const results = toolResults(view.items);
			expect(parse).toHaveBeenCalledTimes(2);
			for (let seq = 1; seq <= 10; seq++) {
				view = reduceView(
					view,
					{ type: "event", instanceId: "i", sessionId: null, seq, event: { type: "text_delta", delta: "x" } },
					seq,
				);
				buildRows(view);
				expect(changeSummary(view.items, view.cwd)).toBe(summary);
				expect(toolResults(view.items)).toBe(results);
			}
			expect(parse).toHaveBeenCalledTimes(2);
			// An immutable replacement invalidates the index/summary; unchanged results still reuse their patch.
			view = {
				...view,
				items: view.items.map((item) => (item.entryId === "r-e" ? result("e", "edit", { patch: writePatch }) : item)),
			};
			buildRows(view);
			expect(parse).toHaveBeenCalledTimes(3);
			expect(changeSummary(view.items, view.cwd)).not.toBe(summary);
			expect(changeSummary(view.items, view.cwd).add).toBe(4);
		} finally {
			parse.mockRestore();
		}
	});

	const items: TranscriptItem[] = [
		{ kind: "user", entryId: "u1", text: "make it", timestamp: 1_000 },
		call("a1", [{ id: "w1", name: "write", args: { path: "src/new.ts", content: "a\nb\n" } }], 2_000),
		result("w1", "write", { pimate: { kind: "write_diff", existed: false, patch: writePatch } }),
		call("a2", [{ id: "e1", name: "edit", args: { path: "src/greet.ts" } }], 3_000),
		result("e1", "edit", { patch: EDIT_PATCH }),
		{ kind: "assistant", entryId: "a3", text: "Done.", toolCalls: [], stopReason: "stop", timestamp: 19_500 },
		{ kind: "user", entryId: "u2", text: "more", timestamp: 30_000 },
		call("a4", [{ id: "e2", name: "edit", args: { path: "src/new.ts" } }], 31_000),
		result("e2", "edit", { patch: "--- src/new.ts\n+++ src/new.ts\n@@ -1,2 +1,2 @@\n-a\n+A\n b\n" }),
		{ kind: "assistant", entryId: "a5", text: "Fixed.", toolCalls: [], stopReason: "stop", timestamp: 33_000 },
		{ kind: "user", entryId: "u3", text: "explain", timestamp: 40_000 },
		{ kind: "assistant", entryId: "a6", text: "Sure.", toolCalls: [], stopReason: "stop", timestamp: 41_000 },
	];

	it("groups per file and scope, concatenating hunks without merging", () => {
		const turn = scopeChanges(items, null, "turn", "u1");
		expect(turn.map((f) => [f.path, f.status, f.add, f.del])).toEqual([
			["src/new.ts", "A", 2, 0],
			["src/greet.ts", "M", 3, 2],
		]);
		const session = scopeChanges(items, null, "session", null);
		expect(session.map((f) => [f.path, f.status, f.add, f.del, f.pieces.length])).toEqual([
			["src/new.ts", "A", 3, 1, 2],
			["src/greet.ts", "M", 3, 2, 1],
		]);
		expect(totals(session)).toEqual({ add: 6, del: 3, counted: true });
		expect(combinedPatch(turn)).toBe(writePatch + EDIT_PATCH);
		expect(scopeChanges(items, null, "turn", "u3")).toEqual([]);
		expect(latestChangedTurn(items, null)).toBe("u2");
		expect(changeReference(turn, "turn")).toBe("このターンの変更（src/new.ts ほか 1 ファイル）について：");
		expect(changeReference(groupByFile([]), "session")).toBe("このセッションの変更について：");
		expect(changeReference(scopeChanges(items, null, "turn", "u2"), "turn")).toBe(
			"このターンの変更（src/new.ts）について：",
		);
	});

	it("folds history without an invented duration, but keeps tool counts and changes", () => {
		const view = reduceView(
			createView("i"),
			{
				type: "subscribed",
				instanceId: "i",
				snapshot: {
					protocol: 1,
					instanceId: "i",
					pid: 1,
					cwd: "/w",
					origin: "pc",
					abducoSession: null,
					startedAt: 0,
					session: { id: "s" },
					status: "idle",
					model: null,
					thinking: null,
					pendingUI: [],
					seq: 0,
				},
				history: { session: { id: "s" }, items },
			} satisfies HostMessage,
			0,
		);
		const rows = buildRows(view);
		const closed = visibleRows(rows, () => false);
		expect(closed.map((r) => r.kind)).toEqual([
			"user",
			"turnSummary",
			"text",
			"user",
			"turnSummary",
			"text",
			"user",
			"text",
		]);
		expect(closed[1]).toMatchObject({ turnId: "u1", durationMs: null, tools: 2, files: 2, add: 5, del: 2 });
		const timed = buildRows({ ...view, turnMs: { u1: 27_000, u2: 500 } });
		expect(timed.find((r) => r.kind === "turnSummary" && r.turnId === "u1")).toMatchObject({ durationMs: 27_000 });
		expect(timed.find((r) => r.kind === "turnSummary" && r.turnId === "u2")).toMatchObject({ durationMs: null });
		const tools = rows.filter((r) => r.kind === "tool");
		expect(tools.map((r) => r.kind === "tool" && [r.meta, r.fold])).toEqual([
			["+2", "turn:u1"],
			["+3 −2", "turn:u1"],
			["+1 −1", "turn:u2"],
		]);
		// The turn in progress is not folded.
		const running = reduceView(
			view,
			{ type: "event", instanceId: "i", sessionId: "s", seq: 1, event: { type: "agent_start" } },
			50_000,
		);
		expect(running.agentActive).toBe(true);
		const last = buildRows({ ...running, items: items.slice(0, 9) });
		expect(last.filter((r) => r.kind === "turnSummary").map((r) => r.key)).toEqual(["turn:u1"]);
	});
});
