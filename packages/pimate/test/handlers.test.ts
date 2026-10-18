import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { createHandlers } from "../src/extension/handlers.ts";
import type { Hub } from "../src/extension/hub.ts";
import * as images from "../src/extension/images.ts";

function setup(idle = true) {
	const ctx = {
		hasUI: true,
		model: { input: ["text", "image"] },
		isIdle: () => idle,
		abort: vi.fn(),
		modelRegistry: { find: vi.fn(() => ({ provider: "faux", id: "one" })) },
	};
	const pi = {
		sendUserMessage: vi.fn(),
		getThinkingLevel: () => "high",
		setThinkingLevel: vi.fn(),
		setModel: vi.fn(async () => true),
		getCommands: () => [{ name: "hello", description: "greet", source: "extension" }],
		events: { on: vi.fn(), emit: vi.fn() },
	};
	const h = { ctx, pi, pendingUI: new Map() };
	return { ctx, pi, h, handlers: createHandlers(h as unknown as Hub) };
}
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});
it("chooses prompt vs followUp vs steer and controls template expansion", async () => {
	const { handlers, pi } = setup(false);
	expect(await handlers.prompt({ text: "hello" })).toEqual({ deliveredAs: "followUp" });
	expect(pi.sendUserMessage).toHaveBeenCalledWith("hello", { deliverAs: "followUp", expandPromptTemplates: false });
	expect(await handlers.prompt({ text: "now", deliverAs: "steer", expandTemplates: true })).toEqual({
		deliveredAs: "steer",
	});
	expect(await setup().handlers.prompt({ text: "idle" })).toEqual({ deliveredAs: "prompt" });
});
it.each([true, false])(
	"uses PC idle=%s for the receipt, preserving steering intent across the idle race",
	async (idle) => {
		const { handlers, pi } = setup(idle);
		expect(await handlers.prompt({ text: "direction", deliverAs: "steer" })).toEqual({
			deliveredAs: idle ? "prompt" : "steer",
		});
		expect(pi.sendUserMessage).toHaveBeenCalledWith("direction", { deliverAs: "steer", expandPromptTemplates: false });
	},
);
it("preserves explicit followUp for older apps and CLI callers", async () => {
	const { handlers, pi } = setup(false);
	expect(await handlers.prompt({ text: "later", deliverAs: "followUp" })).toEqual({ deliveredAs: "followUp" });
	expect(pi.sendUserMessage).toHaveBeenCalledWith("later", { deliverAs: "followUp", expandPromptTemplates: false });
});
it("selects registry models, exposes commands and aborts", async () => {
	const { handlers, ctx, pi } = setup();
	expect(await handlers.set_model({ provider: "faux", id: "one" })).toEqual({ model: { provider: "faux", id: "one" } });
	expect(ctx.modelRegistry.find).toHaveBeenCalledWith("faux", "one");
	expect(pi.setModel).toHaveBeenCalled();
	expect(await handlers.commands({})).toMatchObject({ commands: [{ name: "hello", source: "extension" }] });
	await handlers.abort({});
	expect(ctx.abort).toHaveBeenCalledOnce();
});
it("session operations use the command trampoline and reject while busy", async () => {
	const { handlers, pi } = setup();
	await handlers.session_op({ op: "switch", arg: "/tmp/a b.json" });
	expect(pi.sendUserMessage).toHaveBeenCalledWith('/pimate-session {"op":"switch","arg":"/tmp/a b.json"}', {
		expandPromptTemplates: true,
	});
	expect(() => setup(false).handlers.session_op({ op: "new" })).toThrow("busy");
});
it("subagents RPC times out and removes its listener", async () => {
	vi.useFakeTimers();
	const { handlers, pi } = setup();
	const off = vi.fn();
	pi.events.on.mockReturnValue(off);
	const pending = handlers.subagents_rpc({ method: "ping", timeoutMs: 20 });
	const rejected = expect(pending).rejects.toMatchObject({ code: "timeout" });
	await vi.advanceTimersByTimeAsync(20);
	await rejected;
	expect(off).toHaveBeenCalledOnce();
});
it("subagents RPC reply removes listener and timer", async () => {
	vi.useFakeTimers();
	const { handlers, pi } = setup();
	const off = vi.fn();
	let reply: ((value: unknown) => void) | undefined;
	pi.events.on.mockImplementation((_channel, callback) => {
		reply = callback;
		return off;
	});
	const pending = handlers.subagents_rpc({ method: "ping" });
	reply?.({ ok: true });
	expect(await pending).toEqual({ reply: { ok: true } });
	expect(off).toHaveBeenCalledOnce();
	expect(vi.getTimerCount()).toBe(0);
});

it("lists authenticated models with Pi-compatible reasoning levels and current model", async () => {
	vi.spyOn(SettingsManager, "create").mockReturnValue({ getEnabledModels: () => undefined } as never);
	const h = {
		ctx: {
			hasUI: true,
			scopedModels: [],
			model: { provider: "faux", id: "reasoning" },
			modelRegistry: {
				getAvailable: () => [
					{ provider: "faux", id: "plain", name: "Plain", reasoning: false },
					{
						provider: "faux",
						id: "reasoning",
						name: "Reasoning",
						reasoning: true,
						thinkingLevelMap: { xhigh: "xhigh", max: null, minimal: null },
					},
				],
			},
		},
		pi: { getSettings: () => ({}) },
	} as unknown as Hub;
	const result = await createHandlers(h).models({});
	expect(result.current).toEqual({ provider: "faux", id: "reasoning" });
	expect(result.models[0].thinkingLevels).toEqual(["off"]);
	expect(result.models[1].thinkingLevels).toEqual(["off", "low", "medium", "high", "xhigh"]);
});
it("lists sessions from Pi's actual session dir, sorts dates and marks current; shutdown delegates", async () => {
	const list = vi.spyOn(SessionManager, "list").mockResolvedValue([
		{
			id: "old",
			path: "/old",
			firstMessage: "old",
			messageCount: 1,
			created: new Date(1),
			modified: new Date(2),
			cwd: "/cwd",
			allMessagesText: "test",
		},
		{
			id: "current",
			path: "/current",
			firstMessage: "new",
			messageCount: 2,
			created: new Date(3),
			modified: new Date(4),
			cwd: "/cwd",
			allMessagesText: "test",
		},
	]);
	const shutdown = vi.fn();
	const h = {
		ctx: {
			hasUI: true,
			cwd: "/cwd",
			allMessagesText: "test",
			shutdown,
			sessionManager: { getSessionDir: () => "/custom", getSessionId: () => "current" },
		},
		pi: {},
	} as unknown as Hub;
	const handlers = createHandlers(h);
	expect(await handlers.sessions({ limit: 1 })).toEqual({
		sessions: [
			{ id: "current", path: "/current", firstMessage: "new", messageCount: 2, created: 3, modified: 4, current: true },
		],
	});
	expect(list).toHaveBeenCalledWith("/cwd", "/custom");
	expect((await handlers.sessions({})).sessions).toHaveLength(2);
	await handlers.shutdown({});
	expect(shutdown).toHaveBeenCalledOnce();
});

it.each(["/pimate", "/pimate setup", "  /pimate pair", "/PIMATE\tdevices", "/pimate:1 pair", "/pimate:2"])(
	"rejects remote management prompt %s before dispatch",
	(text) => {
		const { handlers, pi } = setup();
		expect(() => handlers.prompt({ text, expandTemplates: true })).toThrow("PC TUI only");
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
	},
);

function scopedSetup(memory: string[] | undefined, disk: string[] | undefined) {
	const store = { enabled: disk };
	const settings = {
		getEnabledModels: () => store.enabled,
		setEnabledModels: vi.fn((v: string[] | undefined) => {
			store.enabled = v;
		}),
		flush: vi.fn(async () => {}),
	};
	vi.spyOn(SettingsManager, "create").mockReturnValue(settings as unknown as SettingsManager);
	const models = ["a", "b", "c"].map((id) => ({ provider: "faux", id, name: id, reasoning: false }));
	const h = {
		ctx: {
			hasUI: true,
			cwd: "/cwd",
			model: models[0],
			scopedModels: [{ model: models[2] }],
			modelRegistry: { getAvailable: () => models },
		},
		pi: { getSettings: () => ({ enabledModels: memory }) },
	} as unknown as Hub;
	return { settings, handlers: createHandlers(h) };
}
it("reports the live scoped models until enabledModels changes on disk", async () => {
	expect((await scopedSetup(["faux/c"], ["faux/c"]).handlers.models({})).scoped).toEqual([
		{ provider: "faux", id: "c" },
	]);
	expect((await scopedSetup(["faux/c"], ["faux/a", "faux/b"]).handlers.models({})).scoped).toEqual([
		{ provider: "faux", id: "a" },
		{ provider: "faux", id: "b" },
	]);
	expect((await scopedSetup(["faux/c"], undefined).handlers.models({})).scoped).toEqual([]);
});
it("saves scoped models like /scoped-models (all = no filter) and rejects unknown models", async () => {
	const { settings, handlers } = scopedSetup(undefined, undefined);
	expect(await handlers.set_scoped_models({ models: [{ provider: "faux", id: "b" }] })).toEqual({
		scoped: [{ provider: "faux", id: "b" }],
	});
	expect(settings.setEnabledModels).toHaveBeenLastCalledWith(["faux/b"]);
	expect(settings.flush).toHaveBeenCalled();
	await handlers.set_scoped_models({ models: ["a", "b", "c"].map((id) => ({ provider: "faux", id })) });
	expect(settings.setEnabledModels).toHaveBeenLastCalledWith(undefined);
	await handlers.set_scoped_models({ models: [] });
	expect(settings.setEnabledModels).toHaveBeenLastCalledWith(undefined);
	await expect(handlers.set_scoped_models({ models: [{ provider: "faux", id: "zz" }] })).rejects.toMatchObject({
		code: "not_found",
	});
});

it.each(["prompt", "steer", "followUp"] as const)("delivers image content arrays as %s", async (mode) => {
	const { handlers, pi } = setup(mode === "prompt");
	const image = { type: "image", mimeType: "image/jpeg", data: "YQ==" } as const;
	for (const text of ["describe", ""]) {
		expect(
			await handlers.prompt({ text, images: [image, image], ...(mode === "prompt" ? {} : { deliverAs: mode }) }),
		).toEqual({ deliveredAs: mode });
		expect(pi.sendUserMessage).toHaveBeenLastCalledWith([...(text ? [{ type: "text", text }] : []), image, image], {
			...(mode === "prompt" ? {} : { deliverAs: mode }),
			expandPromptTemplates: false,
		});
	}
});
it.each(["text-only", "unknown"])("rejects images on a %s model without sending, but allows text", async (model) => {
	const { handlers, ctx, pi } = setup();
	ctx.model.input = ["text"];
	if (model === "unknown") Object.assign(ctx, { model: undefined });
	expect(() =>
		handlers.prompt({ text: "", images: [{ type: "image", mimeType: "image/jpeg", data: "YQ==" }] }),
	).toThrow("画像対応モデル");
	expect(pi.sendUserMessage).not.toHaveBeenCalled();
	await handlers.prompt({ text: "text only" });
	expect(pi.sendUserMessage).toHaveBeenCalledWith("text only", { expandPromptTemplates: false });
});

it.each([true, false])("acknowledges extension commands without a transcript, idle=%s", async (idle) => {
	const { handlers, pi } = setup(idle);
	for (const text of ["/hello", "/hello name", "/hello\tname", "/hello\nname"])
		expect(await handlers.prompt({ text, expandTemplates: true })).toEqual({ deliveredAs: "command" });
	expect(pi.sendUserMessage).toHaveBeenLastCalledWith("/hello name", {
		expandPromptTemplates: true,
		...(idle ? {} : { deliverAs: "followUp" }),
	});
	// Without expansion it is an ordinary user message, even when the name is registered.
	expect(await handlers.prompt({ text: "/hello" })).toEqual({ deliveredAs: idle ? "prompt" : "followUp" });
});

it.each(["prompt", "skill"])(
	"expands %s commands but does not acknowledge them as extension commands",
	async (source) => {
		const { handlers, pi } = setup(false);
		const name = source === "skill" ? "skill:review" : "review";
		vi.spyOn(pi, "getCommands").mockReturnValue([{ name, source, description: "review" }]);
		expect(await handlers.prompt({ text: `/${name} code`, expandTemplates: true, deliverAs: "steer" })).toEqual({
			deliveredAs: "steer",
		});
		expect(pi.sendUserMessage).toHaveBeenCalledWith(`/${name} code`, {
			expandPromptTemplates: true,
			deliverAs: "steer",
		});
	},
);

it("checks exact live command names, rejects removed commands and preserves paths", async () => {
	const { handlers, pi } = setup();
	vi.spyOn(pi, "getCommands").mockReturnValue([{ name: "hello:1", source: "extension", description: "alias" }]);
	expect(await handlers.prompt({ text: "/hello:1 arg", expandTemplates: true })).toEqual({ deliveredAs: "command" });
	pi.sendUserMessage.mockClear();
	for (const text of ["/hello", "/unknown", "/hello:2 arg"])
		expect(() => handlers.prompt({ text, expandTemplates: true })).toThrow("一覧を確認");
	expect(pi.sendUserMessage).not.toHaveBeenCalled();
	expect(await handlers.prompt({ text: "/home/x", expandTemplates: true })).toEqual({ deliveredAs: "prompt" });
});

it("hides management and internal trampoline commands, including duplicate aliases", async () => {
	const { handlers, pi } = setup();
	const hidden = ["pimate", "pimate:1", "pimate-session", "pimate-session:1"];
	vi.spyOn(pi, "getCommands").mockReturnValue(
		[...hidden, "hello"].map((name) => ({ name, description: name, source: "extension" })),
	);
	expect((await handlers.commands({})).commands.map((c) => c.name)).toEqual(["hello"]);
	for (const name of hidden)
		expect(() => handlers.prompt({ text: `/${name}`, expandTemplates: true })).toThrow("PC TUI only");
	expect(pi.sendUserMessage).not.toHaveBeenCalled();
});

it("rejects image attachments on extension commands instead of silently discarding them", () => {
	const { handlers, pi } = setup();
	expect(() =>
		handlers.prompt({
			text: "/hello",
			expandTemplates: true,
			images: [{ type: "image", mimeType: "image/jpeg", data: "YQ==" }],
		}),
	).toThrow("画像を添付できません");
	expect(pi.sendUserMessage).not.toHaveBeenCalled();
});

it("retrieves all original image indices from current-session user/tool entries, including off-branch", async () => {
	const image = { type: "image", mimeType: "image/gif", data: "YQ==" };
	const entries = {
		user: {
			type: "message",
			message: { role: "user", content: [{ type: "text", text: "hi" }, image, { ...image, data: "Yg==" }] },
		},
		tool: { type: "message", message: { role: "toolResult", content: [image] } },
		assistant: { type: "message", message: { role: "assistant", content: [image] } },
		other: { type: "custom_message", content: [image] },
	};
	const { handlers, ctx } = setup();
	Object.assign(ctx, { sessionManager: { getEntry: (id: keyof typeof entries) => entries[id] } });
	expect(await handlers.entry_image({ entryId: "user", index: 1 })).toEqual({
		image: { mimeType: "image/gif", data: "Yg==" },
	});
	expect(await handlers.entry_image({ entryId: "tool", index: 0 })).toEqual({
		image: { mimeType: "image/gif", data: "YQ==" },
	});
	for (const [entryId, index] of [
		["missing", 0],
		["assistant", 0],
		["other", 0],
		["user", 2],
	] as const)
		await expect(handlers.entry_image({ entryId, index })).rejects.toMatchObject({ code: "not_found" });
});

it("forwards thumbnail mode to the shared entry image resizer", async () => {
	const { handlers, ctx } = setup();
	Object.assign(ctx, {
		sessionManager: {
			getEntry: () => ({
				type: "message",
				message: { role: "user", content: [{ type: "image", mimeType: "image/png", data: "YQ==" }] },
			}),
		},
	});
	const resize = vi
		.spyOn(images, "viewImage")
		.mockResolvedValue({ mimeType: "image/jpeg", data: "Yg==", width: 320, height: 160 });
	expect(await handlers.entry_image({ entryId: "entry", index: 0, thumbnail: true })).toMatchObject({
		image: { width: 320, height: 160 },
	});
	expect(resize).toHaveBeenCalledWith(Buffer.from("YQ==", "base64"), "image/png", true);
});
