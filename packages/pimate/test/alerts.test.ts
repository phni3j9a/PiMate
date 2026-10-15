import type { EventMessage, InstanceSnapshot, SubagentRun } from "@pimate/protocol";
import { expect, it } from "vitest";
import { AlertTracker } from "../src/host/alerts.ts";

const snapshot: InstanceSnapshot = {
	protocol: 1,
	instanceId: "i",
	pid: 1,
	cwd: "/",
	origin: "pc",
	abducoSession: null,
	startedAt: 0,
	session: { id: "s" },
	status: "idle",
	model: null,
	thinking: null,
	pendingUI: [],
	seq: 0,
};
function setup(s = snapshot) {
	const tracker = new AlertTracker(s);
	let seq = s.seq;
	return (event: EventMessage["event"], sessionId = "s") =>
		tracker.next({ type: "event", instanceId: "i", sessionId, seq: ++seq, event });
}
const assistant = (stopReason: string): EventMessage["event"] => ({
	type: "message_end",
	item: { kind: "assistant", entryId: "a", text: "SECRET", toolCalls: [], stopReason },
});
const run = (state: SubagentRun["state"]): SubagentRun => ({
	id: "r",
	backend: "example",
	background: false,
	mode: "single",
	state,
	children: [],
	actions: [],
});
it("only completes an observed normal run; snapshots, aborted and unknown endings stay silent", () => {
	const send = setup({ ...snapshot, agentActive: true });
	expect(send({ type: "agent_settled", aborted: false })).toBeNull();
	for (const [reason, aborted, expected] of [
		["stop", false, "complete"],
		["error", false, "failed"],
		["error", true, undefined],
		["aborted", false, undefined],
		["length", false, undefined],
	] as const) {
		send({ type: "agent_start" });
		send(assistant(reason));
		expect(send({ type: "agent_settled", aborted })?.kind).toBe(expected);
	}
});
it("recovery after a transient model error is success, not failure", () => {
	const send = setup();
	send({ type: "agent_start" });
	send(assistant("error"));
	send(assistant("stop"));
	expect(send({ type: "agent_settled", aborted: false })?.kind).toBe("complete");
});
it("waiting is edge triggered; initial wait/session switches do not replay", () => {
	const send = setup({ ...snapshot, status: "waiting_input" });
	expect(send({ type: "status", status: "waiting_input" })).toBeNull();
	send({ type: "status", status: "running" });
	expect(send({ type: "status", status: "waiting_input" })?.kind).toBe("input");
	send({ type: "agent_start" });
	send(assistant("stop"));
	send({ type: "session_changed", reason: "new", session: { id: "next" } }, "next");
	expect(send({ type: "agent_settled", aborted: false }, "next")).toBeNull();
});
it("children notify only known transitions, never individual completion or snapshot replay", () => {
	const send = setup();
	expect(send({ type: "subagent_run", run: run("failed") })).toBeNull();
	send({ type: "subagent_run", run: run("running") });
	expect(send({ type: "subagent_run", run: run("waiting") })?.kind).toBe("child_waiting");
	expect(send({ type: "subagent_run", run: run("waiting") })).toBeNull();
	expect(send({ type: "subagent_run", run: run("paused") })?.kind).toBe("child_paused");
	expect(send({ type: "subagent_run", run: run("failed") })?.kind).toBe("child_failed");
	expect(send({ type: "subagent_run", run: run("complete") })).toBeNull();
	expect(send({ type: "subagents_reset", state: { backends: [], runs: [run("waiting")] } })).toBeNull();
	expect(send({ type: "subagent_run", run: run("waiting") })).toBeNull();
});
it("duplicate sequences and private text never enter alerts", () => {
	const tracker = new AlertTracker(snapshot);
	const event: EventMessage = {
		type: "event",
		instanceId: "i",
		sessionId: "s",
		seq: 1,
		event: { type: "status", status: "waiting_input" },
	};
	expect(tracker.next(event)).toEqual({ id: "i:1", instanceId: "i", sessionId: "s", kind: "input" });
	expect(tracker.next(event)).toBeNull();
});
it("compares each child even when aggregate parent state stays running", () => {
	const childRun = (state: SubagentRun["state"]): SubagentRun => ({
		...run("running"),
		children: [
			{ id: "a", index: 0, agent: "test", hasTranscript: false, state, actions: [] },
			{ id: "b", index: 1, agent: "test", hasTranscript: false, state: "running", actions: [] },
		],
	});
	const send = setup({ ...snapshot, subagents: { backends: [], runs: [childRun("running")] } });
	expect(send({ type: "subagent_run", run: childRun("failed") })?.kind).toBe("child_failed");
	expect(send({ type: "subagent_run", run: childRun("failed") })).toBeNull();
	expect(send({ type: "subagent_run", run: childRun("complete") })).toBeNull();
});
