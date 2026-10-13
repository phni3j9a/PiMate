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
afterEach(() => vi.useRealTimers());
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
