import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server, Socket } from "node:net";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstanceSnapshot, Request } from "@pimate/protocol";
import { encodeLine, LineDecoder } from "@pimate/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostCore, parseAbducoList, RcClient } from "../src/host/index.ts";
import { privateRunDir } from "../src/runtime.ts";

const dirs: string[] = [];
const servers: Server[] = [];
const sockets: Socket[] = [];
const clients: RcClient[] = [];
const snapshot: InstanceSnapshot = {
	protocol: 1,
	instanceId: "live",
	pid: process.pid,
	cwd: "/tmp",
	origin: "pc",
	abducoSession: null,
	startedAt: 1,
	status: "idle",
	session: null,
	model: null,
	thinking: null,
	pendingUI: [],
	seq: 0,
};
function temp(): string {
	const path = mkdtempSync(join(tmpdir(), "pimate-test-"));
	dirs.push(path);
	return path;
}
async function server(dir: string, handler?: (req: Request, socket: Socket) => void) {
	const s = createServer((socket) => {
		sockets.push(socket);
		socket.setEncoding("utf8");
		const decoder = new LineDecoder(
			(value) => {
				const req = value as Request;
				if (req.method === "hello")
					socket.write(encodeLine({ type: "response", id: req.id, ok: true, result: { snapshot } }));
				else handler?.(req, socket);
			},
			() => {},
		);
		socket.on("data", (chunk) => decoder.push(String(chunk)));
	});
	servers.push(s);
	await new Promise<void>((resolve) => s.listen(join(dir, "live.sock"), resolve));
}
afterEach(async () => {
	for (const c of clients.splice(0)) c.close();
	for (const s of sockets.splice(0)) s.destroy();
	for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
describe("HostCore", () => {
	it("keeps the standalone CLI alive until the detached launcher exits", () => {
		const dir = temp();
		const launcher = join(dir, "launcher");
		writeFileSync(launcher, "#!/bin/sh\n/bin/sleep 0.1\nexit 0\n", { mode: 0o700 });
		const result = spawnSync(process.execPath, ["src/host/cli.ts", "spawn", "--cwd", dir], {
			encoding: "utf8",
			timeout: 10_000,
			env: {
				...process.env,
				PATH: dir,
				PIMATE_RUN_DIR: join(dir, "run"),
				PIMATE_ABDUCO: launcher,
				PIMATE_PI: launcher,
			},
		});
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ isolation: "detached" });
	});
	it("discovers reachable instances, skips malformed entries, and safely cleans stale paths", async () => {
		const dir = temp();
		const outside = join(temp(), "victim");
		writeFileSync(outside, "keep");
		await server(dir);
		writeFileSync(
			join(dir, "live.json"),
			JSON.stringify({ ...snapshot, updatedAt: 1, subagents: { active: 2, waiting: 1, paused: 0, failed: 0 } }),
		);
		writeFileSync(join(dir, "broken.json"), "{not json");
		writeFileSync(join(dir, "wrong.json"), JSON.stringify({ ...snapshot, instanceId: "wrong", pid: "invalid" }));
		writeFileSync(
			join(dir, "stale.json"),
			JSON.stringify({
				...snapshot,
				instanceId: "stale",
				pid: 2147483647,
				socket: outside,
				sockPath: outside,
				updatedAt: 1,
			}),
		);
		writeFileSync(join(dir, "stale.sock"), "stale");
		const host = new HostCore({ runDir: dir, env: { PIMATE_ABDUCO: "/does/not/exist" } });
		expect(await host.list()).toMatchObject([
			{
				instanceId: "live",
				reachable: true,
				pcAttached: null,
				subagents: { active: 2, waiting: 1, paused: 0, failed: 0 },
			},
		]);
		expect(existsSync(join(dir, "stale.json"))).toBe(false);
		expect(existsSync(join(dir, "stale.sock"))).toBe(false);
		expect(existsSync(outside)).toBe(true);
		expect(existsSync(join(dir, "broken.json"))).toBe(true);
	});
	it("rejects public run directories", () => {
		const dir = temp();
		chmodSync(dir, 0o755);
		expect(() => privateRunDir(dir)).toThrow("not private");
	});
	it("parses PC attached and terminated markers", () => {
		const out = [
			"Active sessions (on host server-Macmini)",
			"* Wed\t 2026-10-14 17:46:31\t123\tpimate-one",
			"  Wed\t 2026-10-14 17:46:32\t456\tpimate-two",
			"+ Wed\t 2026-10-14 17:46:33\t789\tpimate-three",
		].join("\n");
		expect(parseAbducoList(out)).toEqual([
			{ name: "pimate-one", pid: 123, attached: true, terminated: false },
			{ name: "pimate-two", pid: 456, attached: false, terminated: false },
			{ name: "pimate-three", pid: 789, attached: false, terminated: true },
		]);
	});
});
describe("RcClient", () => {
	it("handshakes, correlates out-of-order responses, and streams events", async () => {
		const dir = temp();
		const requests: Request[] = [];
		await server(dir, (req, socket) => {
			requests.push(req);
			if (requests.length === 2) {
				for (const r of requests.toReversed())
					socket.write(
						encodeLine({
							type: "response",
							id: r.id,
							ok: true,
							result: r.method === "history" ? { items: [], session: null } : {},
						}),
					);
				socket.write(
					encodeLine({ type: "event", instanceId: "live", sessionId: null, seq: 1, event: { type: "agent_start" } }),
				);
			}
		});
		const client = new RcClient(dir, "live");
		clients.push(client);
		expect(await client.connect()).toEqual(snapshot);
		const event = new Promise((resolve) => client.onEvent(resolve));
		expect(await Promise.all([client.request("history", {}), client.request("abort", {})])).toEqual([
			{ items: [], session: null },
			{},
		]);
		expect(await event).toMatchObject({ seq: 1, event: { type: "agent_start" } });
		expect(requests.every((r) => r.expectInstanceId === "live")).toBe(true);
	});
	it("raw send preserves caller ids/guards and resolves protocol errors without throwing", async () => {
		const dir = temp();
		const requests: Request[] = [];
		await server(dir, (req, socket) => {
			requests.push(req);
			socket.write(
				encodeLine({
					type: "response",
					id: req.id,
					ok: false,
					error: { code: "instance_mismatch", data: { instanceId: "live" } },
				}),
			);
		});
		const client = new RcClient(dir, "live");
		clients.push(client);
		await client.connect();
		const request: Request = {
			id: "caller-id",
			method: "abort",
			params: {},
			expectInstanceId: "wrong",
			expectSessionId: "old",
		};
		expect(await client.send(request)).toEqual({
			type: "response",
			id: "caller-id",
			ok: false,
			error: { code: "instance_mismatch", data: { instanceId: "live" } },
		});
		expect(requests[0]).toEqual(request);
		await client.send({ id: "default", method: "abort" });
		expect(requests[1].expectInstanceId).toBe("live");
		await expect(client.request("abort", {})).rejects.toMatchObject({ code: "instance_mismatch" });
	});
	it("times out and rejects requests on disconnection", async () => {
		const dir = temp();
		await server(dir);
		const client = new RcClient(dir, "live", 30);
		clients.push(client);
		await client.connect();
		await expect(client.request("abort", {})).rejects.toMatchObject({ code: "timeout" });
		const pending = client.request("history", {});
		client.close();
		await expect(pending).rejects.toThrow("closed");
	});
	it("rejects path traversal ids", () => {
		expect(() => new RcClient(temp(), "../outside")).toThrow("Invalid instance");
	});
});

it("extends only auth long-poll and storage operation RC timeouts", async () => {
	const dir = temp();
	await server(dir, (req, socket) => socket.write(encodeLine({ type: "response", id: req.id, ok: true, result: {} })));
	const client = new RcClient(dir, "live");
	clients.push(client);
	await client.connect();
	const timer = vi.spyOn(globalThis, "setTimeout");
	try {
		for (const [method, params, expected] of [
			["auth_wait", { flowId: "flow", afterRevision: 0 }, 27000],
			["auth_list", {}, 32000],
			["auth_logout", { provider: "anthropic" }, 62000],
			["models", {}, 5000],
		] as const) {
			timer.mockClear();
			await client.request(method, params);
			expect(timer.mock.calls.some((call) => call[1] === expected)).toBe(true);
		}
	} finally {
		timer.mockRestore();
	}
});
