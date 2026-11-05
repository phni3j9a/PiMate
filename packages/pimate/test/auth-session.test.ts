import { expect, it, vi } from "vitest";
import { AuthSession } from "../src/host/auth-session.ts";
import type { HostCore } from "../src/host/index.ts";

function fakeCore() {
	const state = {
		alive: new Set<string>(),
		saving: false,
		ready: true,
		spawned: 0,
		flow: undefined as { id: string; status: string } | undefined,
		cancelBusy: false,
		spawnGate: Promise.resolve(),
	};
	const calls: string[] = [];
	const core = {
		env: { HOME: "/home/test" },
		spawn: vi.fn(async () => {
			await state.spawnGate;
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
				if (method === "auth_cancel" && state.cancelBusy) throw Object.assign(new Error("busy"), { code: "busy" });
				return method === "auth_list" ? { flow: state.saving ? { id: "f", status: "saving" } : state.flow } : {};
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
	auth.observe([], 0); // discovery that began before the spawn does not drop it
	expect(auth.owns("login-2")).toBe(true);
	auth.observe([], Date.now() + 1);
	expect(auth.owns("login-2")).toBe(false);
});

it("cancels an interactive flow before shutting down, and defers if saving began meanwhile", async () => {
	const { core, state, calls } = fakeCore();
	const auth = new AuthSession(core, { graceMs: 5, retryMs: 5 });
	const a = {};
	await auth.acquire(a);
	state.flow = { id: "f", status: "working" };
	state.cancelBusy = true; // the device-code flow reached saving between auth_list and auth_cancel
	auth.release(a);
	await vi.waitFor(() => expect(calls.filter((c) => c === "auth_cancel:login-1").length).toBeGreaterThan(1));
	expect(calls).not.toContain("shutdown:login-1");
	state.cancelBusy = false;
	await vi.waitFor(() => expect(calls).toContain("shutdown:login-1"));
	expect(calls.lastIndexOf("auth_cancel:login-1")).toBeLessThan(calls.indexOf("shutdown:login-1"));
});

it("shuts down a login Pi that was still starting when the Host stops", async () => {
	const { core, state, calls } = fakeCore();
	let launch!: () => void;
	state.spawnGate = new Promise((r) => {
		launch = r;
	});
	const auth = new AuthSession(core);
	const holding = auth.acquire({});
	await vi.waitFor(() => expect(core.spawn).toHaveBeenCalled());
	const closing = auth.close();
	launch();
	await holding;
	await closing;
	expect(calls).toContain("shutdown:login-1");
});
