import { describe, expect, it } from "vitest";
import { countSubagents, type SubagentRun } from "../src/index.ts";

const run = (states: SubagentRun["state"][], state: SubagentRun["state"] = "running"): SubagentRun => ({
	id: "r",
	backend: "pi-subagents",
	background: true,
	mode: "parallel",
	state,
	actions: [],
	children: states.map((s, index) => ({
		id: String(index),
		index,
		agent: "a",
		state: s,
		hasTranscript: false,
		actions: [],
	})),
});

describe("countSubagents", () => {
	it("counts children, paused separately from active", () => {
		expect(countSubagents([run(["running", "waiting", "complete"]), run(["paused", "failed"])])).toEqual({
			active: 2,
			waiting: 1,
			paused: 1,
			failed: 1,
		});
	});
	it("uses the run state when a run has no children yet", () => {
		expect(countSubagents([run([], "queued")])).toEqual({ active: 1, waiting: 0, paused: 0, failed: 0 });
	});
});
