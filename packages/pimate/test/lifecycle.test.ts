import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { getHub, type Hub } from "../src/extension/hub.ts";
import extension from "../src/extension/index.ts";

const globalHub = globalThis as typeof globalThis & { __pimateV1Hub?: Hub };
afterEach(() => {
	delete globalHub.__pimateV1Hub;
	vi.unstubAllEnvs();
});
function setup(mobile = false, trust?: string) {
	vi.stubEnv("PIMATE_ORIGIN", mobile ? "mobile" : "pc");
	vi.stubEnv("PIMATE_TRUST", trust);
	const hooks = new Map<string, (...args: any[]) => any>();
	const pi = {
		on: (event: string, fn: (...args: any[]) => any) => {
			hooks.set(event, fn);
			return () => hooks.delete(event);
		},
		registerCommand: vi.fn(),
		events: { on: () => () => {} },
		getThinkingLevel: () => "off",
	} as unknown as ExtensionAPI;
	extension(pi);
	return { hooks, h: getHub() };
}
it.each(["yes", "no"])("only consumes explicit Host-origin trust decision %s", (trust) => {
	const { hooks, h } = setup(true, trust);
	expect(hooks.get("project_trust")?.()).toEqual({ trusted: trust });
	expect(process.env.PIMATE_TRUST).toBeUndefined();
	expect(process.env.PIMATE_ORIGIN).toBeUndefined();
	expect(h.trust).toBe(trust);
});
it.each([
	[false, "yes"],
	[true, undefined],
	[true, "invalid"],
])("leaves ordinary Pi project trust unchanged (%s, %s)", (mobile, trust) => {
	const { hooks } = setup(mobile as boolean, trust as string | undefined);
	expect(hooks.has("project_trust")).toBe(false);
	expect(process.env.PIMATE_TRUST).toBeUndefined();
});
it("tracks PC-only prompts and context in snapshots/events", () => {
	const { hooks, h } = setup();
	const context = { tokens: 20, percent: 1, contextWindow: 2000 };
	h.ctx = { getContextUsage: () => context } as unknown as ExtensionContext;
	const emit = vi.spyOn(h, "emit");
	hooks.get("ui_prompt_start")?.({ kind: "custom", title: "PC confirmation" });
	expect(h.snapshot()).toMatchObject({ pcPrompt: { kind: "custom", title: "PC confirmation" }, context });
	hooks.get("ui_prompt_end")?.({ kind: "custom" });
	expect(h.snapshot().pcPrompt).toBeNull();
	hooks.get("session_compact")?.();
	hooks.get("model_select")?.({ model: { provider: "faux", id: "one" } });
	expect(emit.mock.calls.filter(([event]) => event.type === "context")).toHaveLength(2);
	h.pendingUI.set("answerable", {
		request: { requestId: "answerable", kind: "select", title: "Pick" },
		resolve: () => {},
		cancel: () => {},
	});
	hooks.get("ui_prompt_start")?.({ kind: "select", title: "Pick" });
	expect(h.snapshot().pcPrompt).toBeNull();
	hooks.get("ui_prompt_start")?.({ kind: "select", title: "Built in" });
	expect(h.snapshot().pcPrompt).toEqual({ kind: "select", title: "Built in" });
});
