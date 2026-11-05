import { expect, it, vi } from "vitest";
import { AuthSession } from "../src/host/auth-session.ts";
import type { HostCore } from "../src/host/index.ts";

function fakeCore() {
	const state = { alive: new Set<string>(), saving: false, ready: true, spawned: 0 };
	const calls: string[] = [];
	const core = {
		env: { HOME: "/home/test" },
		spawn: vi.fn(async () => {
			const instanceId = `login-${++state.spawned}`;
			if (state.ready) state.alive.add(instanceId);
			return { instanceId, abducoSession: "pimate-x", attachCommand: "", isolation: "detached" as const };
		}),
		client: (id: string) => ({
			connect: async () => {
				if (!state.alive.has(id)) throw new Error("gone");
				return {};
			},
			request: async (method: string) => {
				calls.push(`${method}:${id}`);
				if (method === "shutdown") state.alive.delete(id);
				return method === "auth_list" ? { flow: state.saving ? { status: "saving" } : undefined } : {};
			},
			close: () => {},
		}),
	} as unknown as Pick<HostCore, "spawn" | "client" | "env">;
	return { core, state, calls };
}

it("defers the shutdown while saving and cancels it when held again during the grace period", async () => {
	const { core, state, calls } = fakeCore();
	const auth = new AuthSession(core, { graceMs: 10, retryMs: 10 });
	const a = {};
	expect(await auth.acquire(a)).toBe("login-1");
	auth.release(a);
	expect(await auth.acquire(a)).toBe("login-1"); // within grace: same Pi, no stop
	await new Promise((r) => setTimeout(r, 30));
	expect(calls).toEqual([]);
	state.saving = true;
	auth.release(a);
	await vi.waitFor(() => expect(calls.filter((c) => c === "auth_list:login-1").length).toBeGreaterThan(1));
	expect(calls).not.toContain("shutdown:login-1");
	state.saving = false;
	await vi.waitFor(() => expect(calls).toContain("shutdown:login-1"));
	expect(auth.owns("login-1")).toBe(false);
	expect(await auth.acquire(a)).toBe("login-2");
	await auth.close();
	expect(calls).toContain("shutdown:login-2");
	await expect(auth.acquire(a)).rejects.toThrow("stopping");
});

it("reports a login Pi that never answers and forgets one that exited", async () => {
	const { core, state } = fakeCore();
	const auth = new AuthSession(core, { readyMs: 50 });
	state.ready = false;
	await expect(auth.acquire({})).rejects.toThrow("did not become ready");
	expect(auth.owns("login-1")).toBe(false);
	state.ready = true;
	expect(await auth.acquire({})).toBe("login-2");
	auth.observe([]);
	expect(auth.owns("login-2")).toBe(false);
});
