import type { EventMessage, InstanceSnapshot, TranscriptItem, UIRequest } from "@pimate/protocol";

type Assistant = Extract<TranscriptItem, { kind: "assistant" }>;

/** `idle`: nothing was running (reply = last answer in history). `closed`: the Pi exited or the socket dropped. */
export interface TurnResult {
	outcome: "done" | "failed" | "aborted" | "waiting_input" | "timeout" | "idle" | "closed";
	reply?: string;
	error?: string;
	pending?: UIRequest[];
}

/** Follows a Pi turn for `pimate prompt --wait` / `pimate wait`: ends at settle, or at a dialog the caller must answer. */
export class TurnWatch {
	private armed: boolean;
	private seq: number | undefined;
	private held: TurnResult | null = null;
	/** A turn started while unarmed: an idle Pi's new turn, so what is held after it is ours. */
	private started = false;
	private early: EventMessage[] = [];
	private last: Assistant | undefined;
	private pending = new Map<string, UIRequest>();

	/** `armed: false` while a prompt is in flight: results are held until {@link arm} knows whose turn they end. */
	constructor(armed = true) {
		this.armed = armed;
	}

	/**
	 * Call with the prompt reply. A busy Pi (steer/followUp) ends the run that took the message, even if that
	 * settle raced ahead of the reply; an idle Pi (prompt) starts a new turn, so only results after its start count.
	 * A dialog that is still open is returned at once: a queued message does not re-send it.
	 */
	arm(busy: boolean): TurnResult | null {
		const held = busy || this.started ? this.held : null;
		this.armed = true;
		this.held = null;
		return held ?? (this.pending.size ? this.result("waiting_input") : null);
	}

	/** A settle whose final answer predates hello (e.g. during agent_before_settle hooks) has none; read it back. */
	settledFrom(items: TranscriptItem[]): TurnResult {
		const last = lastAssistant(items);
		return this.result(last?.stopReason === "error" ? "failed" : "done", last);
	}

	/** Seeds from the hello snapshot and replays events that raced ahead of it. */
	start(snapshot: InstanceSnapshot): TurnResult | null {
		this.seq = snapshot.seq;
		for (const request of snapshot.pendingUI) this.pending.set(request.requestId, request);
		let result = this.pending.size && this.armed ? this.result("waiting_input") : null;
		for (const message of this.early.splice(0)) result = this.next(message) ?? result;
		return result;
	}

	next(message: EventMessage): TurnResult | null {
		if (this.seq === undefined) {
			this.early.push(message);
			return null;
		}
		if (message.seq <= this.seq) return null;
		this.seq = message.seq;
		const e = message.event;
		let result: TurnResult | null = null;
		if (e.type === "agent_start") {
			this.last = undefined;
			if (!this.armed) {
				this.started = true;
				this.held = null;
			}
		} else if (e.type === "message_end" && e.item.kind === "assistant") this.last = e.item;
		else if (e.type === "ui_request_end") this.pending.delete(e.requestId);
		else if (e.type === "ui_request") {
			this.pending.set(e.request.requestId, e.request);
			result = this.result("waiting_input");
		} else if (e.type === "agent_settled")
			result = this.result(e.aborted ? "aborted" : this.last?.stopReason === "error" ? "failed" : "done");
		if (this.armed) return result;
		if (result) this.held = result;
		return null;
	}

	result(outcome: TurnResult["outcome"], last = this.last): TurnResult {
		return {
			outcome,
			...(last?.text ? { reply: last.text } : {}),
			...(last?.errorMessage ? { error: last.errorMessage } : {}),
			...(this.pending.size ? { pending: [...this.pending.values()] } : {}),
		};
	}
}

export function lastAssistant(items: TranscriptItem[]): Assistant | undefined {
	return items.findLast((item): item is Assistant => item.kind === "assistant");
}

/** User and assistant text only: what an outside agent reads before sending a follow-up. */
export function conversation(items: TranscriptItem[]) {
	return items.flatMap<{ kind: "user" | "assistant"; text: string; error?: string }>((item) =>
		item.kind === "user"
			? [{ kind: item.kind, text: item.text }]
			: item.kind === "assistant" && (item.text || item.errorMessage)
				? [{ kind: item.kind, text: item.text, ...(item.errorMessage ? { error: item.errorMessage } : {}) }]
				: [],
	);
}
