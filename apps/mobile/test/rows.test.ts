import type { HostMessage, TranscriptItem } from "@pimate/protocol";
import { describe, expect, it } from "vitest";
import {
	contentText,
	elapsed,
	instanceTitle,
	relativeTime,
	tailLines,
	tildePath,
	tokens,
	toolSubject,
	usageLine,
} from "../src/lib/format";
import { createView, type InstanceView, reduceView } from "../src/lib/instanceView";
import { buildRows, spaceRows } from "../src/lib/transcriptRows";

describe("format", () => {
	it("shortens home paths and picks titles", () => {
		expect(tildePath("/home/server/projects/PiMate")).toBe("~/projects/PiMate");
		expect(tildePath("/Users/me")).toBe("~");
		expect(tildePath("/srv/app")).toBe("/srv/app");
		expect(instanceTitle({ cwd: "/home/a/code/demo/", session: null })).toBe("demo");
		expect(instanceTitle({ cwd: "/x", session: { id: "s", name: " Fix bug " } })).toBe("Fix bug");
	});

	it("formats times and counts", () => {
		const now = Date.UTC(2026, 9, 14, 12);
		expect(relativeTime(now - 10_000, now)).toBe("今");
		expect(relativeTime(now - 5 * 60_000, now)).toBe("5分");
		expect(relativeTime(now - 3 * 3600_000, now)).toBe("3時間");
		expect(relativeTime(now - 30 * 3600_000, now)).toBe("昨日");
		expect(relativeTime(now - 4 * 86400_000, now)).toBe("4日");
		expect(elapsed(64_000)).toBe("1:04");
		expect(elapsed(3_723_000)).toBe("1:02:03");
		expect(tokens(950)).toBe("950");
		expect(tokens(6200)).toBe("6.2k");
		expect(tokens(18_400)).toBe("18k");
		expect(usageLine({ provider: "a", id: "m" }, { input: 6000, output: 210, cacheRead: 200, cost: 0.04 })).toBe(
			"m · 6.2k in · 210 out · $0.04",
		);
		expect(usageLine({ provider: "a", id: "m" }, { input: 10, output: 5, cost: 0.0002 })).toBe("m · 10 in · 5 out");
		expect(usageLine(undefined, undefined)).toBeNull();
	});

	it("derives tool subjects and output text", () => {
		expect(toolSubject("read", { path: "src/greet.ts" })).toBe("src/greet.ts");
		expect(toolSubject("bash", { command: "npm test\necho done" })).toBe("npm test");
		expect(toolSubject("grep", { pattern: "foo", path: "src" })).toBe("foo  src");
		expect(toolSubject("custom", { query: "hello" })).toBe("hello");
		expect(toolSubject("custom", null)).toBe("");
		expect(
			contentText({ content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] }),
		).toBe("ab");
		expect(tailLines("1\n2\n3\n4", 2)).toBe("…\n3\n4");
	});
});

function viewWith(items: TranscriptItem[], status: "idle" | "running" = "idle"): InstanceView {
	const msg: HostMessage = {
		type: "subscribed",
		instanceId: "i",
		snapshot: {
			protocol: 1,
			instanceId: "i",
			pid: 1,
			cwd: "/",
			origin: "pc",
			abducoSession: null,
			startedAt: 0,
			session: { id: "s" },
			status,
			model: null,
			thinking: null,
			pendingUI: [],
			seq: 0,
		},
		history: { session: { id: "s" }, items },
	};
	return reduceView(createView("i"), msg, 0);
}

describe("transcript rows", () => {
	const items: TranscriptItem[] = [
		{ kind: "user", entryId: "u1", text: "hi" },
		{
			kind: "assistant",
			entryId: "a1",
			text: "",
			thinking: "plan",
			toolCalls: [
				{ id: "t1", name: "read", args: { path: "a.ts" } },
				{ id: "t2", name: "bash", args: { command: "npm test" } },
			],
			stopReason: "toolUse",
		},
		{ kind: "tool_result", entryId: "r1", toolCallId: "t1", toolName: "read", text: "1\n2\n3\n", isError: false },
		{ kind: "tool_result", entryId: "r2", toolCallId: "t2", toolName: "bash", text: "boom", isError: true },
		{
			kind: "assistant",
			entryId: "a2",
			text: "Done.",
			toolCalls: [],
			model: { provider: "p", id: "m" },
			usage: { input: 10, output: 5 },
			stopReason: "stop",
		},
		{ kind: "tool_result", entryId: "r3", toolCallId: "orphan", toolName: "ls", text: "x", isError: false },
		{ kind: "other", entryId: "o1", label: "compaction", text: "summary\nmore" },
	];

	it("joins tool calls with results and adds meta lines", () => {
		const rows = buildRows(viewWith(items));
		expect(rows.map((r) => r.kind)).toEqual(["user", "thinking", "tool", "tool", "text", "meta", "tool", "note"]);
		expect(rows[2]).toMatchObject({ name: "read", subject: "a.ts", state: "done", meta: "3 行", output: "1\n2\n3\n" });
		expect(rows[3]).toMatchObject({ name: "bash", state: "error", meta: "エラー" });
		expect(rows[5]).toMatchObject({ text: "m · 10 in · 5 out" });
		expect(rows[6]).toMatchObject({ toolCallId: "orphan", name: "ls" });
		expect(rows[7]).toMatchObject({ text: "compaction: summary" });
	});

	it("shows a stop as 中断しました, also when Pi records it as an error", () => {
		const stopped = (stopReason: string, errorMessage?: string): TranscriptItem[] => [
			{ kind: "assistant", entryId: "a", text: "", toolCalls: [], stopReason, errorMessage },
		];
		expect(buildRows(viewWith(stopped("aborted")))[0]).toMatchObject({ kind: "note", text: "中断しました" });
		expect(buildRows(viewWith(stopped("error", "This operation was aborted")))[0]).toMatchObject({
			kind: "note",
			text: "中断しました",
		});
		expect(buildRows(viewWith(stopped("error", "429 rate limited")))[0]).toMatchObject({ kind: "error" });
	});

	it("shows unanswered tool calls as running only while the instance works", () => {
		const pending: TranscriptItem[] = [
			{ kind: "assistant", entryId: "a", text: "", toolCalls: [{ id: "t", name: "bash", args: {} }] },
		];
		expect(buildRows(viewWith(pending, "running"))[0]).toMatchObject({ state: "running" });
		expect(buildRows(viewWith(pending, "idle"))[0]).toMatchObject({ state: "done" });
	});

	it("appends live tools, streaming text and the dialog card", () => {
		let v = viewWith([{ kind: "user", entryId: "u", text: "go" }], "running");
		const ev = (seq: number, event: Extract<HostMessage, { type: "event" }>["event"]): HostMessage => ({
			type: "event",
			instanceId: "i",
			sessionId: "s",
			seq,
			event,
		});
		v = reduceView(v, ev(1, { type: "tool_start", toolCallId: "t9", toolName: "bash", args: { command: "ls" } }), 500);
		v = reduceView(
			v,
			ev(2, { type: "tool_start", toolCallId: "sub", toolName: "read", args: {}, parentToolCallId: "t9" }),
			500,
		);
		v = reduceView(v, ev(3, { type: "thinking_delta", delta: "hmm" }), 500);
		v = reduceView(v, ev(4, { type: "text_delta", delta: "Hel" }), 500);
		v = reduceView(
			v,
			ev(5, { type: "ui_request", request: { requestId: "r", kind: "confirm", title: "Proceed?" } }),
			500,
		);
		const rows = buildRows(v);
		expect(rows.map((r) => r.kind)).toEqual(["user", "tool", "thinking", "text", "dialog"]);
		expect(rows[1]).toMatchObject({ state: "running", startedAt: 500, subject: "ls" });
		expect(rows[3]).toMatchObject({ text: "Hel", live: true });
		expect(rows[4]).toMatchObject({ request: { requestId: "r", title: "Proceed?" } });
	});

	it("spaces turns by 32 and packs tool rows", () => {
		const spaced = spaceRows(buildRows(viewWith([...items, { kind: "user", entryId: "u2", text: "again" }])));
		expect(spaced.map((r) => r.marginTop)).toEqual([0, 12, 0, 0, 8, 6, 8, 12, 32]);
	});

	it("puts the session notice first", () => {
		const v = { ...viewWith(items), sessionNotice: { reason: "resume", from: "a", to: "b" } };
		const rows = spaceRows(buildRows(v));
		expect(rows[0]).toMatchObject({ kind: "sessionNotice", from: "a", to: "b" });
		expect(rows[1].marginTop).toBe(28);
	});
});
