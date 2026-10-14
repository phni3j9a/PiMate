import type { TranscriptItem } from "@pimate/protocol";

export const MAX_TOOL_TEXT = 32 * 1024;
export const MAX_TOOL_DETAILS_BYTES = 256 * 1024;

/** Bound display transport only; the original Pi session and model-facing content are untouched. */
export function boundToolDetails(details: unknown): { details: unknown; detailsOmitted?: true } {
	try {
		const json = JSON.stringify(details);
		if (json === undefined || Buffer.byteLength(json, "utf8") <= MAX_TOOL_DETAILS_BYTES) return { details };
	} catch {
		// Unserializable extension data must not break the entire history/event stream.
	}
	return { details: undefined, detailsOmitted: true };
}

function record(value: unknown): Record<string, any> {
	return value && typeof value === "object" ? (value as Record<string, any>) : {};
}
function text(content: unknown): string {
	return typeof content === "string"
		? content
		: Array.isArray(content)
			? content
					.filter((c) => c?.type === "text")
					.map((c) => c.text ?? "")
					.join("")
			: "";
}
/** Accept persisted entries and live messages through one normalization path. */
/**
 * Pi 1.2 records an aborted turn as stopReason "error" with an abort error message. Only that message is
 * evidence of an abort: a turn-level "abort requested" flag could relabel a real error that finished first.
 */
export function normalizeMessage(value: unknown, entryId: string): TranscriptItem | null {
	const m = record(value);
	const body = text(m.content);
	const base = { entryId, ...(typeof m.timestamp === "number" ? { timestamp: m.timestamp } : {}) };
	if (m.role === "system" && !body.trim()) return null;
	if (m.role === "user") return { ...base, kind: "user", text: body };
	if (m.role === "assistant") {
		const blocks = Array.isArray(m.content) ? m.content : [];
		return {
			...base,
			kind: "assistant",
			text: body,
			thinking:
				blocks
					.filter((c) => c.type === "thinking")
					.map((c) => c.thinking)
					.join("") || undefined,
			toolCalls: blocks
				.filter((c) => c.type === "toolCall")
				.map((c) => ({ id: c.id, name: c.name, args: c.arguments })),
			model: m.provider && m.model ? { provider: m.provider, id: m.model } : undefined,
			usage: m.usage
				? {
						input: m.usage.input,
						output: m.usage.output,
						cacheRead: m.usage.cacheRead,
						cacheWrite: m.usage.cacheWrite,
						cost: m.usage.cost?.total,
					}
				: undefined,
			stopReason:
				m.stopReason === "error" &&
				typeof m.errorMessage === "string" &&
				/^(?:AbortError:\s*)?(?:This operation was aborted|The operation was aborted|The user aborted a request|Request (?:was )?aborted|Aborted)[.!]?$/i.test(
					m.errorMessage.trim(),
				)
					? "aborted"
					: m.stopReason,
			errorMessage: m.errorMessage,
		};
	}
	if (m.role === "toolResult")
		return {
			...base,
			kind: "tool_result",
			toolCallId: m.toolCallId,
			toolName: m.toolName,
			text: body.slice(0, MAX_TOOL_TEXT),
			...(body.length > MAX_TOOL_TEXT ? { truncated: true } : {}),
			isError: !!m.isError,
			...boundToolDetails(m.details),
		};
	return { ...base, kind: "other", label: m.customType ?? m.role ?? "message", text: body };
}
export function normalizeBranch(entries: readonly unknown[]): TranscriptItem[] {
	return entries.flatMap((value) => {
		const e = record(value);
		if (e.type === "message") {
			const m = normalizeMessage(e.message, e.id);
			return m ? [m] : [];
		}
		if (["compaction", "branch_summary", "custom_message"].includes(e.type))
			return [
				{
					kind: "other" as const,
					entryId: e.id,
					label: e.customType ?? e.type,
					text: e.summary ?? text(e.content),
					timestamp: Date.parse(e.timestamp) || undefined,
				},
			];
		return [];
	});
}

/** Finds the session entry Pi persisted for a live message_end, so live items and history share an entryId. */
export function findMessageEntry<E extends { type: string; id: string }>(branch: E[], message: unknown): E | undefined {
	// Extension messages (role "custom") are persisted as custom_message entries holding the same content object.
	const m = message as { role?: string; customType?: string; content?: unknown };
	return branch.findLast((e) => {
		const x = e as unknown as { message?: unknown; customType?: string; content?: unknown };
		if (e.type === "message") return x.message === message;
		return (
			e.type === "custom_message" && m.role === "custom" && x.customType === m.customType && x.content === m.content
		);
	});
}
