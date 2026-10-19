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
		).toEqual({ entryId: "u", kind: "user", text: "hello", imageCount: 1 });
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
		[{ id: "1", method: "ui_respond", params: { requestId: "r", answers: [{ selected: "A" }] } }, "bad_request"],
		[
			{ id: "1", method: "ui_respond", params: { requestId: "r", answers: [{ selected: [], custom: 1 }] } },
			"bad_request",
		],
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
		normalizeMessage({ role: "assistant", stopReason: "error", errorMessage: "Provider cancelled" }, "a"),
	).toMatchObject({ stopReason: "error" });
	expect(normalizeMessage({ role: "assistant", stopReason: "stop" }, "a")).toMatchObject({ stopReason: "stop" });
});
it("validates M2 methods and bounded positive session limits", () => {
	for (const method of ["models", "sessions", "shutdown"])
		expect(validateRequest({ id: "m2", method }).method).toBe(method);
	for (const limit of [0, -1, 1.2, NaN, Infinity, "10"])
		expect(() => validateRequest({ id: "m2", method: "sessions", params: { limit } })).toThrow("Invalid params");
	expect(validateRequest({ id: "m2", method: "sessions", params: { limit: 10 } }).params).toEqual({ limit: 10 });
	const models = [{ provider: "faux", id: "a" }];
	expect(validateRequest({ id: "s", method: "set_scoped_models", params: { models } }).params).toEqual({ models });
	for (const params of [{}, { models: "faux/a" }, { models: [{ provider: "faux" }] }])
		expect(() => validateRequest({ id: "s", method: "set_scoped_models", params })).toThrow("Invalid params");
	for (const params of [{ model: models[0] }, { model: models[0], thinking: "max" }])
		expect(validateRequest({ id: "d", method: "set_default_model", params }).params).toEqual(params);
	for (const params of [
		{},
		{ model: "faux/a" },
		{ model: { provider: "faux", id: "" } },
		{ model: models[0], thinking: "huge" },
	])
		expect(() => validateRequest({ id: "d", method: "set_default_model", params })).toThrow("Invalid params");
});

describe("image prompt boundary", () => {
	const image = { type: "image", mimeType: "image/png", data: "YQ==" };
	const request = (params: unknown) => ({ id: "image", method: "prompt", params });
	it("allows image-only prompts and bounds image+text without limiting text-only", () => {
		expect(validateRequest(request({ text: "", images: [image] }))).toMatchObject({ params: { images: [image] } });
		expect(() => validateRequest(request({ text: "x".repeat(32768), images: [image] }))).not.toThrow();
		expect(() => validateRequest(request({ text: "x".repeat(32769), images: [image] }))).toThrow();
		expect(() => validateRequest(request({ text: "x".repeat(32769) }))).not.toThrow();
		for (const params of [
			{ text: " " },
			{ text: "", images: [] },
			{ text: "hi", images: Array(5).fill(image) },
			{ text: "hi", images: [{ ...image, data: "invalid" }] },
		])
			expect(() => validateRequest(request(params))).toThrow();
	});
	it("preserves text, counts every original image, and exposes supported previews with their original indices", () => {
		const normalize = (images: unknown[]) =>
			normalizeMessage({ role: "user", content: [{ type: "text", text: "keep text" }, ...images] }, "u");
		expect(normalize([image, image])).toMatchObject({
			text: "keep text",
			imageCount: 2,
			images: [image, image],
			imageIndices: [0, 1],
		});
		for (const first of [
			{ ...image, mimeType: "image/gif" },
			{ ...image, data: Buffer.alloc(512 * 1024 + 1).toString("base64") },
		]) {
			expect(normalize([first, image])).toEqual({
				kind: "user",
				entryId: "u",
				text: "keep text",
				imageCount: 2,
				images: [image],
				imageIndices: [1],
			});
		}
		expect(normalizeMessage({ role: "user", content: [image] }, "u")).toMatchObject({
			text: "",
			imageCount: 1,
			images: [image],
		});
	});
});

it("bounds aggregate history previews, prefers the newest, and preserves original content and counts", () => {
	const image = { type: "image", mimeType: "image/png", data: Buffer.alloc(512 * 1024).toString("base64") };
	const entries = Array.from({ length: 6 }, (_, i) => ({
		type: "message",
		id: `u${i}`,
		message: { role: "user", content: [{ type: "text", text: `text ${i}` }, image, image] },
	}));
	const before = JSON.stringify(entries);
	const normalized = normalizeBranch(entries);
	expect(JSON.stringify(entries)).toBe(before);
	expect(normalized.map((item) => (item.kind === "user" && item.images?.length) || 0)).toEqual([0, 0, 0, 0, 2, 2]);
	for (let i = 0; i < normalized.length; i++)
		expect(normalized[i]).toMatchObject({ kind: "user", text: `text ${i}`, imageCount: 2 });
	expect(
		normalized
			.filter((item) => item.kind === "user")
			.reduce(
				(sum, item) =>
					sum + (item.images ?? []).reduce((bytes, image) => bytes + Buffer.byteLength(image.data, "base64"), 0),
				0,
			),
	).toBe(2 * 1024 * 1024);
	// Live normalization uses the same per-item cap, independently of older history.
	expect(normalizeMessage(entries[0].message, "u0")).toMatchObject({ images: [image, image], imageCount: 2 });
});

it.each(["user", "toolResult"])("bounds live %s images and retains sparse original indices", (role) => {
	const image = { type: "image", mimeType: "image/png", data: Buffer.alloc(512 * 1024).toString("base64") };
	const message = {
		role,
		content: [
			{ ...image, mimeType: "image/gif" },
			{ ...image, data: Buffer.alloc(512 * 1024 + 1).toString("base64") },
			...Array(6).fill(image),
		],
	};
	expect(normalizeMessage(message, "entry")).toMatchObject({
		imageCount: 8,
		images: Array(4).fill(image),
		imageIndices: [2, 3, 4, 5],
	});
});

it("shares the newest-first history budget across user and tool images, skips oversized images", () => {
	const image = { type: "image", mimeType: "image/png", data: Buffer.alloc(512 * 1024).toString("base64") };
	const entries = ["user", "toolResult", "user", "toolResult", "user"].map((role, i) => ({
		type: "message",
		id: `${i}`,
		message: { role, content: [image] },
	}));
	const items = normalizeBranch(entries);
	expect(
		items.map((item) => (item.kind === "user" || item.kind === "tool_result" ? (item.images?.length ?? 0) : 0)),
	).toEqual([0, 1, 1, 1, 1]);
	// A too-large preview must not consume bytes needed by older, smaller images.
	entries.push({
		type: "message",
		id: "large",
		message: { role: "toolResult", content: [{ ...image, data: Buffer.alloc(512 * 1024 + 1).toString("base64") }] },
	});
	expect(normalizeBranch(entries).slice(0, -1)).toEqual(items);
});

it("validates entry_image indices and file_image paths", () => {
	for (const thumbnail of [undefined, false, true])
		expect(() =>
			validateRequest({ id: "image", method: "entry_image", params: { entryId: "entry", index: 0, thumbnail } }),
		).not.toThrow();
	for (const thumbnail of [0, 1, "true", null, []])
		expect(() =>
			validateRequest({ id: "image", method: "entry_image", params: { entryId: "entry", index: 0, thumbnail } }),
		).toThrow("Invalid params");
	for (const index of [0, 2])
		expect(validateRequest({ id: "image", method: "entry_image", params: { entryId: "entry", index } }).method).toBe(
			"entry_image",
		);
	for (const params of [
		{},
		{ entryId: "", index: 0 },
		{ entryId: "entry" },
		...[-1, 0.1, NaN, Infinity, "0", Number.MAX_SAFE_INTEGER + 1].map((index) => ({ entryId: "entry", index })),
	])
		expect(() => validateRequest({ id: "image", method: "entry_image", params })).toThrow("Invalid params");
	for (const thumbnail of [undefined, false, true])
		expect(() =>
			validateRequest({ id: "image", method: "file_image", params: { path: "image.png", thumbnail } }),
		).not.toThrow();
	for (const thumbnail of [0, 1, "true", null, []])
		expect(() =>
			validateRequest({ id: "image", method: "file_image", params: { path: "image.png", thumbnail } }),
		).toThrow("Invalid params");
	for (const path of ["image.png", "/absolute", "~/image", "file:///tmp/image"])
		expect(validateRequest({ id: "image", method: "file_image", params: { path } }).method).toBe("file_image");
	for (const path of [undefined, "", 42, "bad\0path"])
		expect(() => validateRequest({ id: "image", method: "file_image", params: { path } })).toThrow("Invalid params");
});
