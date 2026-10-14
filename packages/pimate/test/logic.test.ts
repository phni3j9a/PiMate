import { describe, expect, it, vi } from "vitest";
import type { Handlers } from "../src/extension/dispatch.ts";
import { dispatch, validateRequest } from "../src/extension/dispatch.ts";
import { findMessageEntry, MAX_TOOL_TEXT, normalizeBranch, normalizeMessage } from "../src/extension/transcript.ts";
import type { UIState } from "../src/extension/ui.ts";
import { raceUI } from "../src/extension/ui.ts";

describe("transcript", () => {
	it("finds the persisted entry for message and custom messages", () => {
		const user = { role: "user", content: "hi" };
		const content = [{ type: "text", text: "done" }];
		const custom = { role: "custom", customType: "subagent", content, display: true };
		const branch = [
			{ type: "message", id: "m1", message: user },
			{ type: "custom_message", id: "c1", customType: "subagent", content: [{ type: "text", text: "done" }] },
			{ type: "custom_message", id: "c2", customType: "subagent", content },
		];
		expect(findMessageEntry(branch, user)?.id).toBe("m1");
		expect(findMessageEntry(branch, custom)?.id).toBe("c2");
		expect(findMessageEntry(branch, { role: "custom", customType: "other", content })).toBeUndefined();
	});

	it("normalizes message roles and drops empty system entries", () => {
		expect(normalizeMessage({ role: "system", content: "  " }, "s")).toBeNull();
		expect(
			normalizeMessage(
				{
					role: "user",
					content: [
						{ type: "text", text: "hello" },
						{ type: "image", data: "secret" },
					],
				},
				"u",
			),
		).toEqual({ entryId: "u", kind: "user", text: "hello" });
		expect(
			normalizeMessage(
				{
					role: "assistant",
					provider: "faux",
					model: "test",
					content: [
						{ type: "thinking", thinking: "hmm" },
						{ type: "text", text: "ok" },
						{ type: "toolCall", id: "t", name: "read", arguments: { path: "a" } },
					],
				},
				"a",
			),
		).toMatchObject({
			kind: "assistant",
			text: "ok",
			thinking: "hmm",
			model: { provider: "faux", id: "test" },
			toolCalls: [{ id: "t", name: "read", args: { path: "a" } }],
		});
	});
	it("truncates tool text and normalizes persisted branch entries", () => {
		const item = normalizeMessage(
			{ role: "toolResult", toolCallId: "t", toolName: "read", content: "x".repeat(MAX_TOOL_TEXT + 1) },
			"r",
		);
		expect(item).toMatchObject({ kind: "tool_result", text: "x".repeat(MAX_TOOL_TEXT), truncated: true });
		expect(
			normalizeBranch([
				{ type: "session", id: "0" },
				{ type: "message", id: "1", message: { role: "user", content: "hi" } },
				{ type: "compaction", id: "2", summary: "summary" },
			]),
		).toMatchObject([
			{ entryId: "1", text: "hi" },
			{ entryId: "2", kind: "other", text: "summary" },
		]);
	});
});
describe("dispatch", () => {
	const hello = vi.fn(() => ({ snapshot: {} }));
	const handlers = { hello } as unknown as Handlers;
	it.each([
		[{ id: "1", method: "unknown" }, "unknown_method"],
		[{ id: "1", method: "hello", params: null }, "bad_request"],
		[{ id: "1", method: "set_thinking", params: { level: ["high"] } }, "bad_request"],
		[{ id: "1", method: "session_op", params: { op: ["new"] } }, "bad_request"],
		[{ id: "1", method: "prompt", params: { text: 3 } }, "bad_request"],
		[{ id: "1", method: "set_thinking", params: { level: "huge" } }, "bad_request"],
		[{ id: "1", method: "session_op", params: { op: "switch" } }, "bad_request"],
		[{ id: "1", method: "hello", expectInstanceId: "other" }, "instance_mismatch"],
		[{ id: "1", method: "hello", expectSessionId: "old" }, "session_changed"],
	])("rejects %j", async (request, code) => {
		hello.mockClear();
		expect(await dispatch(request, { instanceId: "i", sessionId: "s" }, handlers)).toMatchObject({
			ok: false,
			error: { code },
		});
		expect(hello).not.toHaveBeenCalled();
	});
	it("dispatches a matching request and preserves unknown fields", async () => {
		expect(validateRequest({ id: "x", method: "hello", future: true })).toMatchObject({ params: {}, future: true });
		expect(
			await dispatch(
				{ id: "x", method: "hello", expectInstanceId: "i", expectSessionId: "s" },
				{ instanceId: "i", sessionId: "s" },
				handlers,
			),
		).toMatchObject({ id: "x", ok: true });
	});
});
describe("UI race", () => {
	function state(): UIState {
		return { pendingUI: new Map(), emit: vi.fn(), setStatus: vi.fn(), isIdle: () => true };
	}
	it("remote wins, aborts local dialog, and restores status once", async () => {
		const s = state();
		let signal: AbortSignal | undefined;
		let localResolve: (v: string) => void = () => {};
		const promise = raceUI(
			s,
			{ kind: "input", title: "Input" },
			(abort) => {
				signal = abort;
				return new Promise<string>((r) => {
					localResolve = r;
				});
			},
			(r) => r.value,
		);
		const pending = [...s.pendingUI.values()][0];
		pending.resolve({ requestId: pending.request.requestId, value: "remote" });
		expect(await promise).toBe("remote");
		expect(signal?.aborted).toBe(true);
		localResolve("late");
		await Promise.resolve();
		expect(s.pendingUI.size).toBe(0);
		expect(s.emit).toHaveBeenCalledTimes(2);
		expect(s.setStatus).toHaveBeenLastCalledWith("idle");
	});
	it("TUI wins", async () => {
		const s = state();
		expect(
			await raceUI(
				s,
				{ kind: "confirm", title: "OK?" },
				async () => true,
				(r) => !!r.confirmed,
			),
		).toBe(true);
		expect(s.emit).toHaveBeenLastCalledWith(expect.objectContaining({ type: "ui_request_end", by: "tui" }));
	});
	it("local rejection emits end and restores running status", async () => {
		const s = state();
		s.isIdle = () => false;
		await expect(
			raceUI(
				s,
				{ kind: "input", title: "Input" },
				async () => {
					throw new Error("local failed");
				},
				(r) => r.value,
			),
		).rejects.toThrow("local failed");
		expect(s.emit).toHaveBeenLastCalledWith(expect.objectContaining({ type: "ui_request_end", by: "error" }));
		expect(s.setStatus).toHaveBeenLastCalledWith("running");
		expect(s.pendingUI.size).toBe(0);
	});
	it("already cancelled callers still finish cleanly", async () => {
		const s = state();
		const local = vi.fn();
		const controller = new AbortController();
		controller.abort();
		await raceUI(s, { kind: "input", title: "Input" }, local, (r) => r.value, controller.signal);
		expect(local).not.toHaveBeenCalled();
		expect(s.pendingUI.size).toBe(0);
	});
});

it("normalizes known abort errors in live/history without hiding genuine failures", () => {
	for (const errorMessage of [
		"This operation was aborted",
		"AbortError: The operation was aborted.",
		"Request aborted",
	]) {
		const message = {
			role: "assistant",
			content: [],
			stopReason: "error",
			errorMessage,
			usage: { input: 0, output: 0 },
		};
		expect(normalizeMessage(message, "a")).toMatchObject({ stopReason: "aborted" });
		expect(normalizeBranch([{ type: "message", id: "a", message }])[0]).toMatchObject({ stopReason: "aborted" });
	}
	expect(normalizeMessage({ role: "assistant", stopReason: "error", errorMessage: "Bad API key" }, "a")).toMatchObject({
		stopReason: "error",
	});
	expect(
		normalizeMessage({ role: "assistant", stopReason: "error", errorMessage: "Provider cancelled" }, "a", true),
	).toMatchObject({ stopReason: "aborted" });
	expect(normalizeMessage({ role: "assistant", stopReason: "stop" }, "a", true)).toMatchObject({ stopReason: "stop" });
});
it("validates M2 methods and bounded positive session limits", () => {
	for (const method of ["models", "sessions", "shutdown"])
		expect(validateRequest({ id: "m2", method }).method).toBe(method);
	for (const limit of [0, -1, 1.2, NaN, Infinity, "10"])
		expect(() => validateRequest({ id: "m2", method: "sessions", params: { limit } })).toThrow("Invalid params");
	expect(validateRequest({ id: "m2", method: "sessions", params: { limit: 10 } }).params).toEqual({ limit: 10 });
});
