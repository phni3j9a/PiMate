import type { HostMessage, InstanceEvent, InstanceSnapshot, TranscriptItem } from "@pimate/protocol";
import { describe, expect, it } from "vitest";
import { createView, dedupeItems, findDeliveredUserItem, type InstanceView, reduceView } from "../src/lib/instanceView";

const ID = "inst-1";

function snapshot(patch: Partial<InstanceSnapshot> = {}): InstanceSnapshot {
	return {
		protocol: 1,
		instanceId: ID,
		pid: 1,
		cwd: "/home/me/code/demo",
		origin: "pc",
		abducoSession: null,
		startedAt: 0,
		session: { id: "s1", name: "demo" },
		status: "idle",
		model: { provider: "openai", id: "gpt" },
		thinking: "off",
		pendingUI: [],
		seq: 10,
		...patch,
	};
}

const user = (entryId: string, text: string): TranscriptItem => ({ kind: "user", entryId, text });
const assistant = (entryId: string, text: string, extra: Partial<TranscriptItem> = {}): TranscriptItem =>
	({ kind: "assistant", entryId, text, toolCalls: [], ...extra }) as TranscriptItem;

function subscribed(items: TranscriptItem[] = [], snap: Partial<InstanceSnapshot> = {}): HostMessage {
	const s = snapshot(snap);
	return { type: "subscribed", instanceId: ID, snapshot: s, history: { session: s.session, items } };
}

let seq = 10;
function ev(event: InstanceEvent, s = ++seq): HostMessage {
	return { type: "event", instanceId: ID, sessionId: "s1", seq: s, event };
}

function ready(items: TranscriptItem[] = [], snap: Partial<InstanceSnapshot> = {}): InstanceView {
	seq = snap.seq ?? 10;
	return reduceView(createView(ID), subscribed(items, snap), 1000);
}

function apply(view: InstanceView, ...msgs: HostMessage[]): InstanceView {
	return msgs.reduce((v, m) => reduceView(v, m, 2000), view);
}

describe("instance view reducer", () => {
	it("subscribed replaces everything and seeds streaming from the snapshot", () => {
		const v = ready([user("u1", "hi"), assistant("a1", "hello")], {
			status: "running",
			streaming: { text: "partial", thinking: "hmm" },
		});
		expect(v.phase).toBe("ready");
		expect(v.items.map((i) => i.entryId)).toEqual(["u1", "a1"]);
		expect(v.streaming).toEqual({ text: "partial", thinking: "hmm" });
		expect(v.runningSince).toBe(1000);
		expect(v.seq).toBe(10);
		expect(v.cwd).toBe("/home/me/code/demo");

		// A second resync drops live state that is not in the new snapshot.
		const live = apply(v, ev({ type: "tool_start", toolCallId: "t1", toolName: "bash", args: {} }));
		const again = reduceView(live, subscribed([user("u1", "hi")], { seq: 20 }), 3000);
		expect(again.tools).toEqual({});
		expect(again.items).toHaveLength(1);
		expect(again.streaming).toEqual({ text: "", thinking: "" });
		expect(again.seq).toBe(20);
	});

	it("dedupes history by entryId (first position, last content)", () => {
		const items = dedupeItems([user("u1", "a"), assistant("a1", "x"), user("u1", "b")]);
		expect(items).toEqual([user("u1", "b"), assistant("a1", "x")]);
		expect(ready([user("u1", "a"), user("u1", "a")]).items).toHaveLength(1);
	});

	it("ignores events before subscribed, for other instances, and stale seqs", () => {
		const loading = createView(ID);
		expect(reduceView(loading, ev({ type: "text_delta", delta: "x" }), 0)).toBe(loading);
		const v = ready();
		const other: HostMessage = {
			type: "event",
			instanceId: "other",
			sessionId: "s1",
			seq: 99,
			event: { type: "text_delta", delta: "x" },
		};
		expect(reduceView(v, other, 0)).toBe(v);
		expect(reduceView(v, ev({ type: "text_delta", delta: "x" }, 10), 0)).toBe(v);
		const a = apply(v, ev({ type: "text_delta", delta: "a" }, 15));
		const b = apply(a, ev({ type: "text_delta", delta: "b" }, 12));
		expect(b.streaming.text).toBe("a");
		expect(b.seq).toBe(15);
	});

	it("streams deltas and clears them on the assistant message_end, upserting by entryId", () => {
		let v = ready([user("u1", "hi")]);
		v = apply(
			v,
			ev({ type: "status", status: "running" }),
			ev({ type: "thinking_delta", delta: "let me " }),
			ev({ type: "thinking_delta", delta: "think" }),
			ev({ type: "text_delta", delta: "Hel" }),
			ev({ type: "text_delta", delta: "lo" }),
		);
		expect(v.streaming).toEqual({ text: "Hello", thinking: "let me think" });
		expect(v.status).toBe("running");
		v = apply(v, ev({ type: "message_end", item: user("u2", "next") }));
		expect(v.streaming.text).toBe("Hello");
		v = apply(v, ev({ type: "message_end", item: assistant("a1", "Hello") }));
		expect(v.streaming).toEqual({ text: "", thinking: "" });
		expect(v.items.map((i) => i.entryId)).toEqual(["u1", "u2", "a1"]);
		v = apply(v, ev({ type: "message_end", item: assistant("a1", "Hello!") }));
		expect(v.items).toHaveLength(3);
		expect((v.items[2] as { text: string }).text).toBe("Hello!");
	});

	it("tracks tools by toolCallId", () => {
		let v = ready();
		v = apply(
			v,
			ev({ type: "tool_start", toolCallId: "t1", toolName: "bash", args: { command: "npm test" } }),
			ev({
				type: "tool_update",
				toolCallId: "t1",
				toolName: "bash",
				partial: { content: [{ type: "text", text: "> vitest" }] },
			}),
		);
		expect(v.tools.t1).toMatchObject({ status: "running", partialText: "> vitest", startedAt: 2000 });
		v = apply(v, ev({ type: "tool_end", toolCallId: "t1", toolName: "bash", isError: true, durationMs: 1200 }));
		expect(v.tools.t1).toMatchObject({ status: "error", durationMs: 1200 });
		v = apply(v, ev({ type: "tool_update", toolCallId: "nope", toolName: "bash", partial: {} }));
		expect(v.tools.nope).toBeUndefined();
		expect(v.toolOrder).toEqual(["t1"]);
	});

	it("marks still-running tools done when the agent settles", () => {
		let v = ready();
		v = apply(v, ev({ type: "tool_start", toolCallId: "t1", toolName: "bash", args: {} }));
		v = apply(v, ev({ type: "agent_settled", aborted: true }));
		expect(v.tools.t1.status).toBe("done");
	});

	it("session_changed resets the view and waits for the next resync", () => {
		let v = ready([user("u1", "hi")], { session: { id: "s1", name: "old" } });
		v = apply(v, ev({ type: "session_changed", reason: "resume", session: { id: "s2", name: "new" } }));
		expect(v.phase).toBe("resyncing");
		expect(v.items).toEqual([]);
		expect(v.sessionNotice).toEqual({ reason: "resume", from: "old", to: "new" });
		// Deltas are ignored until the resync.
		expect(apply(v, ev({ type: "text_delta", delta: "x" })).streaming.text).toBe("");
		v = reduceView(v, subscribed([user("u9", "resumed")], { session: { id: "s2", name: "new" }, seq: 50 }), 3000);
		expect(v.phase).toBe("ready");
		expect(v.items.map((i) => i.entryId)).toEqual(["u9"]);
		expect(v.sessionNotice).toEqual({ reason: "resume", from: "old", to: "new" });
	});

	it("notices a different session after a reconnect resync", () => {
		const v = ready([], { session: { id: "s1", name: "old" } });
		const next = reduceView(v, subscribed([], { session: { id: "s2", name: "other" } }), 0);
		expect(next.sessionNotice).toEqual({ reason: "switch", from: "old", to: "other" });
		expect(reduceView(v, subscribed([]), 0).sessionNotice).toBeNull();
	});

	it("keeps ui requests as data", () => {
		let v = ready([], { pendingUI: [{ requestId: "r0", kind: "confirm", title: "Old?" }] });
		expect(v.pendingUI).toHaveLength(1);
		v = apply(
			v,
			ev({ type: "ui_request", request: { requestId: "r1", kind: "select", title: "Pick", options: ["a"] } }),
		);
		expect(v.pendingUI.map((r) => r.requestId)).toEqual(["r0", "r1"]);
		v = apply(v, ev({ type: "ui_request_end", requestId: "r0", by: "tui" }));
		expect(v.pendingUI.map((r) => r.requestId)).toEqual(["r1"]);
		v = apply(v, ev({ type: "ui_prompt", phase: "start", kind: "custom", title: "Custom" }));
		expect(v.uiPrompt).toEqual({ kind: "custom", title: "Custom" });
		v = apply(v, ev({ type: "ui_prompt", phase: "end", kind: "custom" }));
		expect(v.uiPrompt).toBeNull();
	});

	it("notes questions answered elsewhere and dedupes the TUI prompt of a mirrored dialog", () => {
		let v = ready([user("u1", "go")], {
			pendingUI: [
				{ requestId: "r0", kind: "confirm", title: "Old?" },
				{ requestId: "r1", kind: "input", title: "Name" },
			],
			pcPrompt: { kind: "custom", title: "graph" },
			context: { tokens: 1000, contextWindow: 10_000, percent: 10 },
		});
		expect(v.uiPrompt).toEqual({ kind: "custom", title: "graph" });
		expect(v.context?.percent).toBe(10);
		v = apply(
			v,
			ev({ type: "ui_request_end", requestId: "r0", by: "tui" }),
			ev({ type: "ui_request_end", requestId: "r1", by: "remote" }),
		);
		expect(v.pendingUI).toEqual([]);
		expect(v.uiNotes).toEqual([{ requestId: "r0", afterEntryId: "u1", text: "PC で回答されました：Old?" }]);
		// The TUI side of a dialog the phone also shows is not a separate "PC only" prompt.
		v = apply(
			v,
			ev({ type: "ui_prompt", phase: "end", kind: "custom" }),
			ev({ type: "ui_request", request: { requestId: "r2", kind: "select", title: "Pick", options: ["a"] } }),
			ev({ type: "ui_prompt", phase: "start", kind: "select", title: "Pick" }),
		);
		expect(v.uiPrompt).toBeNull();
		// pimate_ask: the PC asks the questionnaire as its own select/input dialogs (other titles).
		v = apply(
			v,
			ev({
				type: "ui_request",
				request: { requestId: "q", kind: "questionnaire", title: "DB?", questions: [{ question: "DB?", options: [] }] },
			}),
			ev({ type: "ui_prompt", phase: "start", kind: "input", title: "Context\n\n(1/2) DB?" }),
		);
		expect(v.uiPrompt).toBeNull();
		v = apply(v, ev({ type: "context", context: null }));
		expect(v.context).toBeNull();
		v = reduceView(v, { type: "instance_gone", instanceId: ID }, 0);
		expect(v.pendingUI).toEqual([]);
	});

	it("tells a running turn from a dialog opened outside one", () => {
		// An extension command's dialog while idle: waiting_input, but no turn to stop.
		let v = apply(ready(), ev({ type: "status", status: "waiting_input" }));
		expect(v.agentActive).toBe(false);
		v = apply(v, ev({ type: "agent_start" }), ev({ type: "status", status: "waiting_input" }));
		expect(v.agentActive).toBe(true);
		v = apply(v, ev({ type: "agent_settled", aborted: false }), ev({ type: "status", status: "idle" }));
		expect(v.agentActive).toBe(false);
		// Older RC snapshots without the explicit flag: transcript heuristic remains compatible.
		const done = [user("u", "hi"), assistant("a", "ok", { stopReason: "stop" })];
		expect(ready(done, { status: "waiting_input" }).agentActive).toBe(false);
		expect(ready([user("u", "hi")], { status: "waiting_input" }).agentActive).toBe(true);
		expect(ready(done, { status: "running" }).agentActive).toBe(true);
	});

	it("keeps a settled-looking answer stoppable while an extension dialog holds the run open", () => {
		const done = [user("u", "hi"), assistant("a", "ok", { stopReason: "stop" })];
		const v = ready(done, {
			status: "waiting_input",
			agentActive: true,
			pendingUI: [{ requestId: "confirm", kind: "confirm", title: "Continue?" }],
		});
		expect(v.agentActive).toBe(true);
		expect(apply(v, ev({ type: "agent_settled", aborted: false })).agentActive).toBe(false);
		// An explicit false also wins over the old transcript/status heuristic.
		expect(ready([user("u", "hi")], { status: "waiting_input", agentActive: false }).agentActive).toBe(false);
		expect(ready(done, { status: "running", agentActive: false }).agentActive).toBe(false);
	});

	it("times a live turn through settlement, including final generation and extension dialogs", () => {
		let v = ready();
		v = reduceView(v, ev({ type: "agent_start" }), 1_000);
		v = reduceView(v, ev({ type: "message_end", item: user("u", "go") }), 1_000);
		const items = v.items;
		v = reduceView(v, ev({ type: "text_delta", delta: "answer" }), 8_000);
		expect(v.items).toBe(items); // streaming must not invalidate transcript/diff caches
		v = reduceView(v, ev({ type: "message_end", item: assistant("a", "answer", { timestamp: 2_000 }) }), 9_000);
		v = reduceView(v, ev({ type: "status", status: "waiting_input" }), 10_000);
		expect(v.turnMs).toEqual({});
		v = reduceView(v, ev({ type: "agent_settled", aborted: false }), 13_000);
		expect(v.turnMs).toEqual({ u: 12_000 });
		expect(v.turnClock).toBeNull();
		// Completed local measurements survive a same-session resubscription, not a session switch.
		expect(reduceView(v, subscribed(v.items), 14_000).turnMs).toEqual({ u: 12_000 });
		expect(reduceView(v, subscribed([], { session: { id: "s2" } }), 14_000).turnMs).toEqual({});
	});

	it("does not invent a turn duration after joining or reconnecting mid-run", () => {
		let v = ready();
		v = reduceView(v, ev({ type: "agent_start" }), 1_000);
		v = reduceView(v, ev({ type: "message_end", item: user("u", "go") }), 1_000);
		v = reduceView(v, subscribed(v.items, { seq: 20, status: "running", agentActive: true }), 5_000);
		expect(v.turnClock).toBeNull();
		v = reduceView(v, ev({ type: "agent_settled", aborted: false }, 21), 9_000);
		expect(v.turnMs).toEqual({});
	});

	it("times thinking only when seen from its start", () => {
		let v = ready([user("u", "hi")], { status: "running" });
		v = reduceView(v, ev({ type: "thinking_delta", delta: "hm" }), 5_000);
		v = reduceView(v, ev({ type: "thinking_delta", delta: "m" }), 6_000);
		v = reduceView(v, ev({ type: "text_delta", delta: "ok" }), 9_000);
		v = reduceView(v, ev({ type: "message_end", item: assistant("a", "ok", { thinking: "hmm" }) }), 9_500);
		expect(v.thinkingMs).toEqual({ a: 4_000 });
		// Joined mid-stream: no number is made up.
		let w = ready([user("u", "hi")], { status: "running", streaming: { text: "", thinking: "earlier" } });
		w = reduceView(w, ev({ type: "thinking_delta", delta: "more" }), 5_000);
		w = reduceView(w, ev({ type: "message_end", item: assistant("a", "ok", { thinking: "x" }) }), 9_000);
		expect(w.thinkingMs).toEqual({});
	});

	it("handles status, model, session name and instance_gone", () => {
		let v = ready();
		v = apply(
			v,
			ev({ type: "status", status: "waiting_input" }),
			ev({ type: "model", model: { provider: "x", id: "y" } }),
			ev({ type: "session_info", name: "renamed" }),
		);
		expect(v.status).toBe("waiting_input");
		expect(v.runningSince).toBe(2000);
		expect(v.model).toEqual({ provider: "x", id: "y" });
		expect(v.session?.name).toBe("renamed");
		v = apply(v, ev({ type: "status", status: "idle" }));
		expect(v.runningSince).toBeNull();
		v = reduceView(v, { type: "instance_gone", instanceId: ID }, 0);
		expect(v.phase).toBe("gone");
		expect(
			reduceView(createView(ID), { type: "subscribe_error", instanceId: ID, code: "unreachable" }, 0),
		).toMatchObject({
			phase: "error",
			error: { code: "unreachable" },
		});
	});

	it("skips unknown events but advances seq", () => {
		const v = ready();
		const next = reduceView(v, ev({ type: "future_event" } as unknown as InstanceEvent, 30), 0);
		expect(next.seq).toBe(30);
		expect(next.items).toBe(v.items);
	});

	it("recognises a newly delivered user message", () => {
		const v = ready([user("u1", "same"), user("u2", "same ")]);
		expect(findDeliveredUserItem(v, "same", ["u1", "u2"])).toBe(false);
		expect(findDeliveredUserItem(v, "same", ["u1"])).toBe(true);
	});
});

it("matches multi-image sends by original indices, but never confirms from partial previews", () => {
	const a = { type: "image", mimeType: "image/png", data: "YQ==" } as const;
	const b = { ...a, data: "Yg==" };
	const view = {
		...createView("i"),
		items: [
			{ kind: "user" as const, entryId: "new", text: "same", imageCount: 2, images: [b, a], imageIndices: [1, 0] },
		],
	};
	expect(findDeliveredUserItem(view, "same", [], [a, b])).toBe(true);
	expect(findDeliveredUserItem(view, "same", ["new"], [a, b])).toBe(false);
	expect(
		findDeliveredUserItem(
			{ ...view, items: [{ ...view.items[0]!, images: [b], imageIndices: [1] }] },
			"same",
			[],
			[a, b],
		),
	).toBe(false);
	expect(
		findDeliveredUserItem({ ...view, items: [{ ...view.items[0]!, imageIndices: [0, 1] }] }, "same", [], [a, b]),
	).toBe(false);
});
