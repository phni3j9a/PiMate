import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer, type Socket } from "node:net";
import { type NetworkInterfaceInfo, tmpdir } from "node:os";
import { join } from "node:path";
import {
	type EventMessage,
	encodeLine,
	type HostMessage,
	type InstanceSnapshot,
	LineDecoder,
	type PairResponse,
	type Request,
} from "@pimate/protocol";
import { afterEach, expect, it } from "vitest";
import { WebSocket } from "ws";
import { Hub } from "../src/extension/hub.ts";
import { HostConfig } from "../src/host/config.ts";
import { HostCore } from "../src/host/index.ts";
import { HostServer, listenAddresses } from "../src/host/server.ts";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn();
});
function temp(): string {
	const dir = mkdtempSync(join(tmpdir(), "pimate-server-test-"));
	cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}
function inbox(ws: WebSocket) {
	const messages: HostMessage[] = [];
	const received: HostMessage[] = [];
	let notify: (() => void) | undefined;
	ws.on("message", (data) => {
		const message = JSON.parse(data.toString());
		messages.push(message);
		received.push(message);
		notify?.();
	});
	return {
		messages,
		received,
		async next(type: HostMessage["type"]): Promise<HostMessage> {
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error(`Missing ${type}: ${JSON.stringify(messages)}`)), 4000);
				const check = () => {
					const i = messages.findIndex((m) => m.type === type);
					if (i < 0) return;
					clearTimeout(timer);
					notify = undefined;
					resolve(messages.splice(i, 1)[0]);
				};
				notify = check;
				check();
			});
		},
	};
}
async function setup(fake = false) {
	const dir = temp();
	const core = new HostCore({ runDir: join(dir, "run"), env: { PIMATE_ABDUCO: "/absent" }, probeTimeoutMs: 100 });
	const snapshot: InstanceSnapshot = {
		protocol: 1,
		instanceId: "live",
		pid: process.pid,
		cwd: dir,
		origin: "pc",
		abducoSession: null,
		startedAt: 1,
		session: { id: "session" },
		status: "idle",
		model: null,
		thinking: null,
		pendingUI: [],
		seq: 0,
	};
	const sockets = new Set<Socket>();
	const requests: Request[] = [];
	const hooks: { history?: (req: Request, socket: Socket) => void } = {};
	if (fake) {
		writeFileSync(join(core.runDir, "live.json"), JSON.stringify({ ...snapshot, updatedAt: 1 }));
		const rc = createServer((socket) => {
			sockets.add(socket);
			socket.on("close", () => sockets.delete(socket));
			socket.on("error", () => {});
			const decoder = new LineDecoder((value) => {
				const req = value as Request;
				requests.push(req);
				if (req.method === "history" && hooks.history) {
					hooks.history(req, socket);
					return;
				}
				if (req.expectSessionId && req.expectSessionId !== snapshot.session?.id) {
					socket.write(
						encodeLine({
							type: "response",
							id: req.id,
							ok: false,
							error: { code: "session_changed", data: { current: "session" } },
						}),
					);
					return;
				}
				socket.write(
					encodeLine({
						type: "response",
						id: req.id,
						ok: true,
						result:
							req.method === "hello"
								? { snapshot }
								: req.method === "history"
									? { session: snapshot.session, items: [] }
									: {},
					}),
				);
			});
			socket.on("data", (data) => decoder.push(data.toString()));
		});
		await new Promise<void>((resolve) => rc.listen(join(core.runDir, "live.sock"), resolve));
		cleanup.push(async () => {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((r) => rc.close(() => r()));
		});
	}
	const server = new HostServer({
		core,
		configDir: join(dir, "config"),
		listen: ["127.0.0.1"],
		port: 0,
		pollMs: 60_000,
		authTimeoutMs: 60,
	});
	const [bound] = await server.start();
	cleanup.push(() => server.close());
	const base = `http://127.0.0.1:${bound.port}`;
	const pair = async (code = server.config.createCode()) =>
		fetch(`${base}/pair`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ code, deviceName: "Test phone" }),
		});
	async function connect(token?: string, protocol = 1) {
		const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, { origin: "http://native-app" });
		const box = inbox(ws);
		const closed = new Promise<number>((resolve) => ws.once("close", resolve));
		await new Promise<void>((resolve) => ws.once("open", resolve));
		cleanup.push(() => ws.terminate());
		if (token !== undefined)
			ws.send(JSON.stringify({ type: "auth", token, protocol, app: { version: "test", platform: "test" } }));
		return { ws, box, closed, send: (value: unknown) => ws.send(JSON.stringify(value)) };
	}
	async function authed() {
		const credentials = (await (await pair()).json()) as PairResponse;
		const client = await connect(credentials.token);
		await client.box.next("auth_ok");
		await client.box.next("instances");
		return { ...client, credentials };
	}
	const event = (seq: number, value: EventMessage["event"]): EventMessage => ({
		type: "event",
		instanceId: "live",
		sessionId: "session",
		seq,
		event: value,
	});
	const emit = (seq: number, value: EventMessage["event"]) => {
		snapshot.seq = seq;
		for (const socket of sockets) socket.write(encodeLine(event(seq, value)));
	};
	return { dir, core, server, base, pair, connect, authed, snapshot, sockets, hooks, requests, event, emit };
}

it("selects only loopback and addresses Tailscale reports as its own", () => {
	const addresses = [
		"100.63.255.255",
		"100.64.0.1",
		"100.127.255.255",
		"100.128.0.1",
		"192.168.1.3",
		"fd7a:115c:a1e0::1",
		"fd7a:115c:a1e1::1",
		"127.0.0.1",
		"::1",
	];
	const ifaces = { test: addresses.map((address) => ({ address }) as NetworkInterfaceInfo) };
	// A CGNAT address that Tailscale does not own (e.g. a carrier interface) must not be selected.
	expect(listenAddresses(ifaces, [])).toEqual(["127.0.0.1"]);
	expect(
		listenAddresses(ifaces, ["100.64.0.1", "100.127.255.255", "FD7A:115C:A1E0::1", "100.128.0.1", "192.168.1.3"]),
	).toEqual(["127.0.0.1", "100.64.0.1", "100.127.255.255", "fd7a:115c:a1e0::1"]);
});
it("pairs exactly once, hashes tokens, rejects expired/invalid codes and keeps config private", async () => {
	const t = await setup();
	const code = t.server.config.createCode();
	const responses = await Promise.all([t.pair(code), t.pair(code)]);
	expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
	const paired = (await responses.find((r) => r.status === 200)!.json()) as PairResponse;
	expect(paired.token).toHaveLength(43);
	expect(readFileSync(join(t.dir, "config/devices.json"), "utf8")).not.toContain(paired.token);
	for (const file of ["host.json", "devices.json"])
		expect(statSync(join(t.dir, "config", file)).mode & 0o777).toBe(0o600);
	expect((await t.pair(t.server.config.createCode(Date.now() - 1))).status).toBe(410);
	expect((await t.pair("a".repeat(32))).status).toBe(401);
	const other = new HostConfig(join(t.dir, "config"));
	expect(other.host).toEqual(t.server.config.host);
	chmodSync(join(t.dir, "config"), 0o755);
	expect(() => new HostConfig(join(t.dir, "config"))).toThrow("not private");
});
it("decodes pairing bodies whose chunks split a multi-byte character", async () => {
	const t = await setup();
	const body = Buffer.from(JSON.stringify({ code: t.server.config.createCode(), deviceName: "日本の端末" }));
	const cut = body.indexOf(Buffer.from("日")) + 1;
	const status = await new Promise<number>((resolve, reject) => {
		const req = httpRequest(
			`${t.base}/pair`,
			{ method: "POST", headers: { "content-type": "application/json" } },
			(res) => {
				res.resume();
				resolve(res.statusCode ?? 0);
			},
		);
		req.on("error", reject);
		req.write(body.subarray(0, cut));
		setTimeout(() => req.end(body.subarray(cut)), 20);
	});
	expect(status).toBe(200);
	expect(t.server.config.devices().map((d) => d.name)).toEqual(["日本の端末"]);
});
it("rejects malformed/oversized pairing bodies, content types and browser origins; exposes health only", async () => {
	const t = await setup();
	for (const body of ["{", "null", "{}", JSON.stringify({ code: "a".repeat(5000), deviceName: "test" })]) {
		const response = await fetch(`${t.base}/pair`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "bad_request" });
	}
	expect((await fetch(`${t.base}/pair`, { method: "POST", body: "{}" })).status).toBe(400);
	expect(
		(
			await fetch(`${t.base}/pair`, {
				method: "POST",
				headers: { "content-type": "application/json", origin: "https://evil.example" },
				body: "{}",
			})
		).status,
	).toBe(400);
	expect(await (await fetch(`${t.base}/health`)).json()).toEqual({ ok: true, protocol: 1 });
	expect((await fetch(`${t.base}/missing`)).status).toBe(404);
});
it("authenticates, handles ping, rejects wrong tokens/protocol, times out unauthenticated sockets and revokes", async () => {
	const t = await setup();
	const good = await t.authed();
	good.send({ type: "ping", t: 123 });
	expect(await good.box.next("pong")).toEqual({ type: "pong", t: 123 });
	const bad = await t.connect("bad");
	expect(await bad.box.next("auth_error")).toMatchObject({ code: "invalid_token" });
	expect(await bad.closed).toBe(4401);
	const mismatch = await t.connect(good.credentials.token, 99);
	expect(await mismatch.box.next("auth_error")).toMatchObject({ code: "protocol_mismatch" });
	expect(await mismatch.closed).toBe(4400);
	expect(await (await t.connect()).closed).toBe(4408);
	new HostConfig(join(t.dir, "config")).revoke(good.credentials.deviceId);
	await t.server.refresh();
	expect(await good.closed).toBe(4403);
});
it("closes invalid messages and slow consumers", async () => {
	const t = await setup();
	const invalid = await t.authed();
	invalid.send({ type: "unknown" });
	expect(await invalid.closed).toBe(4400);
	const slow = await t.authed();
	// Simulate the server-side ws send queue without allocating an 8 MB network backlog.
	const peers = (t.server as unknown as { peers: Set<{ ws: WebSocket }> }).peers;
	for (const peer of peers) Object.defineProperty(peer.ws, "bufferedAmount", { value: 9 * 1024 * 1024 });
	await t.server.refresh();
	expect(await slow.closed).toBe(1009);
});
it("buffers resync events, filters snapshot seq, coalesces consecutive deltas and flushes before other events", async () => {
	const t = await setup(true);
	t.snapshot.seq = 2;
	t.hooks.history = (request, socket) => {
		socket.write(encodeLine(t.event(2, { type: "text_delta", delta: "already in snapshot" })));
		socket.write(encodeLine(t.event(3, { type: "text_delta", delta: "new" })));
		setTimeout(
			() =>
				socket.write(
					encodeLine({
						type: "response",
						id: request.id,
						ok: true,
						result: { session: t.snapshot.session, items: [] },
					}),
				),
			20,
		);
	};
	const client = await t.authed();
	client.send({ type: "subscribe", instanceId: "live" });
	const subscribed = await client.box.next("subscribed");
	expect(subscribed).toMatchObject({ snapshot: { seq: 2 } });
	expect(client.box.received.filter((m) => m.type === "subscribed" || m.type === "event")[0]?.type).toBe("subscribed");
	expect(await client.box.next("event")).toMatchObject({ seq: 3, event: { delta: "new" } });
	t.emit(4, { type: "text_delta", delta: "a" });
	t.emit(5, { type: "text_delta", delta: "b" });
	t.emit(6, { type: "thinking_delta", delta: "c" });
	t.emit(7, { type: "thinking_delta", delta: "d" });
	t.emit(8, { type: "agent_settled", aborted: false });
	expect(await client.box.next("event")).toMatchObject({ seq: 5, event: { type: "text_delta", delta: "ab" } });
	expect(await client.box.next("event")).toMatchObject({ seq: 7, event: { type: "thinking_delta", delta: "cd" } });
	expect(await client.box.next("event")).toMatchObject({ seq: 8, event: { type: "agent_settled" } });
	t.emit(9, { type: "text_delta", delta: "timer" });
	expect(await client.box.next("event")).toMatchObject({ seq: 9 });
});
it("shares subscriptions, forwards guard errors unchanged, reconnects/resyncs and broadcasts disappearance", async () => {
	const t = await setup(true);
	const a = await t.authed();
	const b = await t.authed();
	a.send({ type: "subscribe", instanceId: "live" });
	await a.box.next("subscribed");
	b.send({ type: "subscribe", instanceId: "live" });
	await b.box.next("subscribed");
	expect(t.sockets.size).toBe(1);
	const request = {
		id: "kept-id",
		method: "prompt",
		params: { text: "hello" },
		expectSessionId: "old",
		expectInstanceId: "live",
	};
	a.send({ type: "rc", instanceId: "live", request });
	expect(await a.box.next("rc_result")).toMatchObject({
		response: { id: "kept-id", ok: false, error: { code: "session_changed", data: { current: "session" } } },
	});
	expect(t.requests.find((r) => r.id === request.id)).toEqual(request);
	a.send({ type: "rc", instanceId: "missing", request });
	expect(await a.box.next("rc_result")).toMatchObject({ response: { error: { code: "not_found" } } });
	a.send({ type: "subscribe", instanceId: "missing" });
	expect(await a.box.next("subscribe_error")).toMatchObject({ code: "not_found" });
	for (const socket of t.sockets) socket.destroy();
	await a.box.next("subscribed");
	await b.box.next("subscribed");
	t.emit(1, { type: "agent_start" });
	expect(await a.box.next("event")).toMatchObject({ seq: 1 });
	expect(await b.box.next("event")).toMatchObject({ seq: 1 });
	rmSync(join(t.core.runDir, "live.json"));
	await t.server.refresh();
	expect(await a.box.next("instance_gone")).toMatchObject({ instanceId: "live" });
	expect(await b.box.next("instance_gone")).toMatchObject({ instanceId: "live" });
	expect(await a.box.next("instances")).toEqual({ type: "instances", instances: [] });
});
it("returns RC results on demand without a subscription", async () => {
	const t = await setup(true);
	const client = await t.authed();
	client.send({ type: "rc", instanceId: "live", request: { id: "abort", method: "abort", params: {} } });
	expect(await client.box.next("rc_result")).toMatchObject({ response: { id: "abort", ok: true } });
	expect(t.requests.find((r) => r.id === "abort")?.expectInstanceId).toBe("live");
});
it("tracks streaming text/thinking in snapshots and resets at message, settled and session boundaries", async () => {
	const dir = temp();
	const before = process.env.PIMATE_RUN_DIR;
	process.env.PIMATE_RUN_DIR = dir;
	const hub = new Hub();
	if (before === undefined) delete process.env.PIMATE_RUN_DIR;
	else process.env.PIMATE_RUN_DIR = before;
	await hub.start();
	cleanup.push(() => hub.stop());
	hub.emit({ type: "text_delta", delta: "hello" });
	hub.emit({ type: "text_delta", delta: " world" });
	hub.emit({ type: "thinking_delta", delta: "think" });
	const snapshot = hub.snapshot();
	expect(snapshot.streaming).toEqual({ text: "hello world", thinking: "think" });
	for (const event of [
		{ type: "message_end", item: { kind: "user", entryId: "u", text: "x" } },
		{ type: "agent_settled", aborted: false },
		{ type: "session_changed", reason: "new", session: { id: "next" } },
	] as const) {
		hub.emit(event);
		expect(hub.snapshot().streaming).toEqual({ text: "", thinking: "" });
		hub.emit({ type: "text_delta", delta: "new" });
	}
	expect(snapshot.streaming?.text).toBe("hello world");
	hub.writeMeta();
	expect(JSON.parse(readFileSync(hub.metaPath, "utf8")).streaming).toBeUndefined();
});

it("broadcasts changed instance summaries and reports existing but unreachable RCs", async () => {
	const t = await setup();
	const client = await t.authed();
	writeFileSync(join(t.core.runDir, "live.json"), JSON.stringify({ ...t.snapshot, status: "running", updatedAt: 2 }));
	await t.server.refresh();
	expect(await client.box.next("instances")).toMatchObject({
		instances: [{ instanceId: "live", status: "running", pcAttached: null }],
	});
	client.send({ type: "subscribe", instanceId: "live" });
	expect(await client.box.next("subscribe_error")).toMatchObject({ code: "unreachable" });
});
