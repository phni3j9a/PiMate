import type { EventMessage, InstanceSnapshot, PiAlert, SubagentRun } from "@pimate/protocol";

/** Live-only classifier. Snapshots seed state, never produce notifications. No conversation text retained. */
export class AlertTracker {
	private seq: number;
	private sessionId: string | null;
	private waiting: boolean;
	private started = false;
	private stopReason: string | undefined;
	private children = new Map<string, string>();

	constructor(snapshot: InstanceSnapshot) {
		this.seq = snapshot.seq;
		this.sessionId = snapshot.session?.id ?? null;
		this.waiting = snapshot.status === "waiting_input";
		for (const run of snapshot.subagents?.runs ?? []) this.remember(run);
	}

	private states(run: SubagentRun): [string, string][] {
		return run.children.length
			? run.children.map((child) => [JSON.stringify([run.id, child.id]), child.state])
			: [[JSON.stringify([run.id, null]), run.state]];
	}

	private remember(run: SubagentRun): void {
		for (const [key, state] of this.states(run)) this.children.set(key, state);
	}

	next(message: EventMessage): PiAlert | null {
		if (message.seq <= this.seq) return null;
		this.seq = message.seq;
		const e = message.event;
		if (message.sessionId !== this.sessionId || e.type === "session_changed") {
			this.sessionId = message.sessionId;
			this.started = false;
			this.stopReason = undefined;
			this.waiting = false;
			this.children.clear();
			return null;
		}
		let kind: PiAlert["kind"] | undefined;
		if (e.type === "agent_start") {
			this.started = true;
			this.stopReason = undefined;
		} else if (e.type === "message_end" && e.item.kind === "assistant") {
			this.stopReason = e.item.stopReason;
		} else if (e.type === "agent_settled") {
			if (this.started && !e.aborted) {
				if (this.stopReason === "error") kind = "failed";
				else if (this.stopReason === "stop") kind = "complete";
			}
			this.started = false;
			this.stopReason = undefined;
		} else if (e.type === "status") {
			if (e.status === "waiting_input" && !this.waiting) kind = "input";
			this.waiting = e.status === "waiting_input";
		} else if (e.type === "subagents_reset") {
			this.children.clear();
			for (const run of e.state.runs) this.remember(run);
		} else if (e.type === "subagent_run") {
			// One generic notification per run update, even when several children change together.
			const changed = this.states(e.run).filter(
				([key, state]) => this.children.has(key) && this.children.get(key) !== state,
			);
			this.remember(e.run);
			if (changed.some(([, state]) => state === "failed")) kind = "child_failed";
			else if (changed.some(([, state]) => state === "paused")) kind = "child_paused";
			else if (changed.some(([, state]) => state === "waiting")) kind = "child_waiting";
		}
		if (!kind || !this.sessionId) return null;
		return {
			id: `${message.instanceId}:${message.seq}`,
			instanceId: message.instanceId,
			sessionId: this.sessionId,
			kind,
		};
	}
}
