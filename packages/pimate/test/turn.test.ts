import type { EventMessage, InstanceEvent, InstanceSnapshot, TranscriptItem, UIRequest } from "@pimate/protocol";
import { expect, it } from "vitest";
import { conversation, lastAssistant, TurnWatch } from "../src/host/turn.ts";

const snapshot = (seq: number, pendingUI: UIRequest[] = []) =>
	({ instanceId: "i", seq, status: "running", pendingUI }) as unknown as InstanceSnapshot;
let seq = 0;
const ev = (event: InstanceEvent, at = ++seq): EventMessage => ({
	type: "event",
	instanceId: "i",
	sessionId: "s",
	seq: at,
	event,
});
const assistant = (text: string, stopReason = "stop", errorMessage?: string) =>
	ev({
		type: "message_end",
		item: { kind: "assistant", entryId: text, text, toolCalls: [], stopReason, errorMessage },
	});
const dialog: UIRequest = { requestId: "r1", kind: "confirm", title: "Delete?" };

it("replays events that raced ahead of hello, skipping ones the snapshot already covers", () => {
	seq = 5;
	const watch = new TurnWatch();
	expect(watch.next(ev({ type: "agent_settled", aborted: false }, 5))).toBeNull();
	expect(watch.next(assistant("late"))).toBeNull();
	expect(watch.next(ev({ type: "agent_settled", aborted: false }, seq + 1))).toBeNull();
	expect(watch.start(snapshot(5))).toEqual({ outcome: "done", reply: "late" });
});

it("drops the previous turn's settle when the prompt started a new turn", () => {
	seq = 0;
	const watch = new TurnWatch(false);
	expect(watch.start(snapshot(0, [dialog]))).toBeNull();
	expect(watch.next(assistant("previous"))).toBeNull();
	expect(watch.next(ev({ type: "agent_settled", aborted: false }))).toBeNull();
	expect(watch.next(ev({ type: "ui_request_end", requestId: "r1", by: "tui" }))).toBeNull();
	expect(watch.next(ev({ type: "agent_start" }))).toBeNull();
	expect(watch.arm(false)).toBeNull();
	expect(watch.next(assistant("ours"))).toBeNull();
	expect(watch.next(ev({ type: "agent_settled", aborted: false }))).toEqual({ outcome: "done", reply: "ours" });
});

it("keeps its own turn's result when it arrives together with the prompt reply", () => {
	seq = 0;
	const watch = new TurnWatch(false);
	expect(watch.start(snapshot(0))).toBeNull();
	expect(watch.next(ev({ type: "agent_settled", aborted: false }))).toBeNull();
	expect(watch.next(ev({ type: "agent_start" }))).toBeNull();
	expect(watch.next(assistant("ours"))).toBeNull();
	expect(watch.next(ev({ type: "agent_settled", aborted: false }))).toBeNull();
	expect(watch.arm(false)).toEqual({ outcome: "done", reply: "ours" });
});

it("returns a dialog that is already open when the message only got queued", () => {
	seq = 0;
	const watch = new TurnWatch(false);
	expect(watch.start(snapshot(0, [dialog]))).toBeNull();
	expect(watch.arm(true)).toEqual({ outcome: "waiting_input", pending: [dialog] });
});

it("reads back a final answer sent before it connected", () => {
	const watch = new TurnWatch();
	const items: TranscriptItem[] = [
		{ kind: "assistant", entryId: "1", text: "", toolCalls: [], stopReason: "error", errorMessage: "rate limited" },
	];
	expect(watch.settledFrom(items)).toEqual({ outcome: "failed", error: "rate limited" });
	expect(watch.settledFrom([{ kind: "assistant", entryId: "2", text: "hi", toolCalls: [] }])).toEqual({
		outcome: "done",
		reply: "hi",
	});
});

it("keeps a busy run's settle that raced ahead of the steer reply", () => {
	seq = 0;
	const watch = new TurnWatch(false);
	expect(watch.start(snapshot(0))).toBeNull();
	expect(watch.next(assistant("steered"))).toBeNull();
	expect(watch.next(ev({ type: "agent_settled", aborted: false }))).toBeNull();
	expect(watch.arm(true)).toEqual({ outcome: "done", reply: "steered" });
	expect(new TurnWatch(false).arm(true)).toBeNull();
});

it("reports failures, aborts, dialogs and timeouts", () => {
	seq = 0;
	const watch = new TurnWatch();
	expect(watch.start(snapshot(0))).toBeNull();
	expect(watch.next(assistant("", "error", "rate limited"))).toBeNull();
	expect(watch.next(ev({ type: "agent_settled", aborted: false }))).toEqual({
		outcome: "failed",
		error: "rate limited",
	});
	expect(watch.next(ev({ type: "agent_settled", aborted: true }))).toMatchObject({ outcome: "aborted" });
	expect(watch.next(ev({ type: "ui_request", request: dialog }))).toMatchObject({
		outcome: "waiting_input",
		pending: [dialog],
	});
	expect(watch.result("timeout")).toMatchObject({ outcome: "timeout", pending: [dialog] });
	expect(new TurnWatch().start(snapshot(0, [dialog]))).toEqual({ outcome: "waiting_input", pending: [dialog] });
});

it("reduces history to the conversation and finds the last answer", () => {
	const items: TranscriptItem[] = [
		{ kind: "user", entryId: "1", text: "hi" },
		{ kind: "assistant", entryId: "2", text: "", toolCalls: [{ id: "t", name: "read", args: {} }] },
		{ kind: "tool_result", entryId: "3", toolCallId: "t", toolName: "read", text: "file", isError: false },
		{ kind: "assistant", entryId: "4", text: "done", toolCalls: [] },
		{ kind: "other", entryId: "5", label: "compaction" },
		{ kind: "assistant", entryId: "6", text: "", toolCalls: [], errorMessage: "boom" },
	];
	expect(conversation(items)).toEqual([
		{ kind: "user", text: "hi" },
		{ kind: "assistant", text: "done" },
		{ kind: "assistant", text: "", error: "boom" },
	]);
	expect(lastAssistant(items)?.entryId).toBe("6");
	expect(lastAssistant([])).toBeUndefined();
});
