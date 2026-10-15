import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { createHandlers } from "../src/extension/handlers.ts";
import type { Hub } from "../src/extension/hub.ts";

function setup(idle = true) {
	const ctx = {
		hasUI: true,
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
	const h = {
		ctx: {
			hasUI: true,
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
		pi: {},
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

it.each(["/pimate", "/pimate setup", "  /pimate pair", "/PIMATE\tdevices"])(
	"rejects remote management prompt %s before dispatch",
	(text) => {
		const { handlers, pi } = setup();
		expect(() => handlers.prompt({ text, expandTemplates: true })).toThrow("PC TUI only");
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
	},
);
