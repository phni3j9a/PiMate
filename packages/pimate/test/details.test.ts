import { expect, it } from "vitest";
import {
	boundToolDetails,
	MAX_TOOL_DETAILS_BYTES,
	normalizeBranch,
	normalizeMessage,
} from "../src/extension/transcript.ts";

it("preserves ordinary edit patches in history and live messages", () => {
	const details = { patch: "--- file\n+++ file\n@@ -1 +1 @@\n-old\n+new\n", diff: "-old\n+new" };
	const message = { role: "toolResult", toolCallId: "edit-1", toolName: "edit", content: [], details };
	const live = normalizeMessage(message, "entry");
	expect(live).toMatchObject({ kind: "tool_result", details });
	expect(live).not.toHaveProperty("detailsOmitted");
	expect(normalizeBranch([{ type: "message", id: "entry", message }])).toEqual([live]);
	expect(boundToolDetails(details).details).toBe(details);
});
it("accepts exactly 256 KiB of JSON and omits one byte more", () => {
	const details = "a".repeat(MAX_TOOL_DETAILS_BYTES - 2); // JSON quotes also count.
	expect(boundToolDetails(details)).toEqual({ details });
	expect(boundToolDetails(`${details}b`)).toEqual({ details: undefined, detailsOmitted: true });
});
it("measures UTF-8 JSON bytes, not JavaScript characters", () => {
	const details = { output: "あ".repeat(Math.ceil(MAX_TOOL_DETAILS_BYTES / 3)) };
	const message = { role: "toolResult", toolCallId: "big", toolName: "subagent", content: [], details };
	const live = normalizeMessage(message, "entry");
	expect(live).toMatchObject({ details: undefined, detailsOmitted: true });
	expect(normalizeBranch([{ type: "message", id: "entry", message }])).toEqual([live]);
	expect(message.details).toBe(details);
});
it("omits unserializable details rather than throwing into history/events", () => {
	const circular: Record<string, unknown> = {};
	circular.self = circular;
	for (const details of [circular, { value: 1n }])
		expect(boundToolDetails(details)).toEqual({ details: undefined, detailsOmitted: true });
	expect(boundToolDetails(undefined)).toEqual({ details: undefined });
	expect(boundToolDetails(null)).toEqual({ details: null });
});
