import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import { afterEach, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { Hub } from "../src/extension/hub.ts";
import { LOGIN_PI_ARGS } from "../src/host/auth-session.ts";
import { HostConfig } from "../src/host/config.ts";
import { HostCore } from "../src/host/index.ts";
import { HostServer, type HostServerOptions, listenAddresses } from "../src/host/server.ts";
import { setWatch, watches } from "../src/host/webhook.ts";
import { PACKAGE_VERSION } from "../src/package.ts";

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
async function setup(
	fake = false,
	beforeStart?: (configDir: string) => void,
	authSession?: HostServerOptions["authSession"],
) {
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
	const hooks: { history?: (req: Request, socket: Socket) => void; ui?: (req: Request, socket: Socket) => void } = {};
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
				if (req.method === "ui_respond" && hooks.ui) {
					hooks.ui(req, socket);
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
	if (beforeStart) {
		new HostConfig(join(dir, "config"));
		beforeStart(join(dir, "config"));
	}
	const server = new HostServer({
		core,
		configDir: join(dir, "config"),
		listen: ["127.0.0.1"],
		port: 0,
		pollMs: 60_000,
		authTimeoutMs: 60,
		authSession,
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
		expect(await client.box.next("auth_ok")).toMatchObject({ host: { providerAuth: true, dirs: true, github: true } });
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
	expect(await (await fetch(`${t.base}/health`)).json()).toMatchObject({
		ok: true,
		protocol: 1,
		rcProtocol: 1,
		version: PACKAGE_VERSION,
		pid: process.pid,
		incompatible: {},
	});
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
it("delivers one-shot results emitted while the snapshot was built, before subscribed", async () => {
	const t = await setup(true);
	t.snapshot.seq = 3;
	t.hooks.history = (request, socket) => {
		socket.write(encodeLine(t.event(2, { type: "session_op_done", op: "new", cancelled: false })));
		socket.write(encodeLine(t.event(3, { type: "text_delta", delta: "already in snapshot" })));
		socket.write(encodeLine(t.event(4, { type: "text_delta", delta: "new" })));
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
	await client.box.next("subscribed");
	await client.box.next("event");
	await client.box.next("event");
	const seen = client.box.received
		.filter((m) => m.type === "subscribed" || m.type === "event")
		.map((m) => (m.type === "event" ? `${m.seq}:${m.event.type}` : m.type));
	expect(seen).toEqual(["2:session_op_done", "subscribed", "4:text_delta"]);
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
it("hides login Pis, stops ones it does not own, and holds its own only for auth RPCs", async () => {
	const t = await setup(
		true,
		(config) => {
			const meta = join(config, "../run/live.json");
			writeFileSync(meta, JSON.stringify({ ...JSON.parse(readFileSync(meta, "utf8")), purpose: "auth" }));
		},
		{ graceMs: 20 },
	);
	const shutdowns = () => t.requests.filter((r) => r.method === "shutdown").length;
	await vi.waitFor(() => expect(shutdowns()).toBe(1)); // left by an earlier Host
	const spawn = vi.spyOn(t.core, "spawn").mockResolvedValue({
		instanceId: "live",
		abducoSession: "pimate-live",
		attachCommand: "pimate attach pimate-live",
		isolation: "detached",
	});
	const c = await t.authed();
	expect(c.box.received.find((m) => m.type === "auth_ok")).toMatchObject({ host: { authSession: true } });
	expect(c.box.received.find((m) => m.type === "instances")).toMatchObject({ instances: [] });
	c.send({ type: "rc", instanceId: "live", request: { id: "early", method: "auth_list", params: {} } });
	expect(await c.box.next("rc_result")).toMatchObject({ response: { id: "early", error: { code: "not_found" } } });
	c.send({ type: "auth_session", requestId: "a1", holdId: "screen-1" });
	c.send({ type: "auth_session", requestId: "a2", holdId: "screen-2" });
	expect(await c.box.next("auth_session_result")).toMatchObject({ ok: true, instanceId: "live" });
	expect(await c.box.next("auth_session_result")).toMatchObject({ ok: true, instanceId: "live" });
	expect(spawn).toHaveBeenCalledExactlyOnceWith({ cwd: expect.any(String), args: LOGIN_PI_ARGS, purpose: "auth" });
	// A screen closed before its reply still gets one (the app's pending request must settle).
	c.send({ type: "auth_session", requestId: "a3", holdId: "screen-3" });
	c.send({ type: "auth_session_end", holdId: "screen-3" });
	expect(await c.box.next("auth_session_result")).toMatchObject({ requestId: "a3", ok: true });
	c.send({ type: "rc", instanceId: "live", request: { id: "list", method: "auth_list", params: {} } });
	expect(await c.box.next("rc_result")).toMatchObject({ response: { id: "list", ok: true } });
	c.send({ type: "rc", instanceId: "live", request: { id: "prompt", method: "prompt", params: { text: "x" } } });
	expect(await c.box.next("rc_result")).toMatchObject({ response: { id: "prompt", error: { code: "unsupported" } } });
	expect(t.requests.some((r) => r.id === "prompt")).toBe(false);
	await t.server.refresh(); // still owned: neither listed nor stopped
	expect(shutdowns()).toBe(1);
	c.send({ type: "auth_session_end", holdId: "screen-1" });
	await new Promise((r) => setTimeout(r, 60)); // grace is 20 ms: screen-2 still holds it
	expect(shutdowns()).toBe(1);
	c.send({ type: "auth_session_end", holdId: "screen-2" });
	await vi.waitFor(() => expect(shutdowns()).toBe(2));
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

it("supports authenticated folders and rejects invalid spawn without invoking the launcher", async () => {
	const s = await setup();
	const spawn = vi.spyOn(s.core, "spawn");
	const c = await s.authed();
	c.send({ type: "folders", requestId: "folders" });
	expect(await c.box.next("folders_result")).toMatchObject({
		requestId: "folders",
		home: expect.any(String),
		folders: expect.any(Array),
	});
	c.send({ type: "dirs", requestId: "dirs", path: "/" });
	expect(await c.box.next("dirs_result")).toMatchObject({ requestId: "dirs", dirs: expect.arrayContaining(["tmp"]) });
	c.send({ type: "spawn", requestId: "bad", params: { cwd: "relative" } });
	expect(await c.box.next("spawn_result")).toMatchObject({ requestId: "bad", ok: false, code: "bad_request" });
	expect(spawn).not.toHaveBeenCalled();
});
it("spawns with only typed CLI flags, sends initial prompt once and rate limits", async () => {
	const s = await setup(true);
	const spawn = vi.spyOn(s.core, "spawn").mockResolvedValue({
		instanceId: "live",
		abducoSession: "pimate-test",
		attachCommand: "pimate attach pimate-test",
		isolation: "detached",
	});
	const c = await s.authed();
	c.send({
		type: "spawn",
		requestId: "start",
		params: {
			cwd: s.dir,
			trust: true,
			model: { provider: "openai", id: "gpt-6-luna" },
			thinking: "off",
			askTool: true,
			message: "first",
			command: "not-executed",
		},
	});
	expect(await c.box.next("spawn_result")).toMatchObject({ requestId: "start", ok: true, instanceId: "live" });
	expect(spawn).toHaveBeenCalledWith({
		cwd: s.dir,
		trust: true,
		args: ["--model", "openai/gpt-6-luna", "--thinking", "off", "--tools", "+pimate_ask"],
	});
	expect(s.requests.filter((r) => r.method === "prompt")).toEqual([
		expect.objectContaining({ params: { text: "first", expandTemplates: false } }),
	]);
	c.send({ type: "spawn", requestId: "again", params: { cwd: s.dir } });
	expect(await c.box.next("spawn_result")).toMatchObject({ requestId: "again", ok: false, code: "spawn_failed" });
	expect(spawn).toHaveBeenCalledOnce();
});
it("reports initial prompt uncertainty without retrying or launching a second Pi", async () => {
	const s = await setup();
	const spawn = vi.spyOn(s.core, "spawn").mockResolvedValue({
		instanceId: "new",
		abducoSession: "pimate-new",
		attachCommand: "pimate attach pimate-new",
		isolation: "detached",
	});
	const request = vi.fn().mockRejectedValue(new Error("transport lost"));
	vi.spyOn(s.core, "client").mockReturnValue({
		connect: async () => ({}),
		request,
		close: () => {},
	} as unknown as ReturnType<HostCore["client"]>);
	const c = await s.authed();
	c.send({ type: "spawn", requestId: "start", params: { cwd: s.dir, message: "first" } });
	expect(await c.box.next("spawn_result")).toMatchObject({
		ok: true,
		instanceId: "new",
		messageError: expect.stringContaining("transport lost"),
	});
	expect(spawn).toHaveBeenCalledOnce();
	expect(request).toHaveBeenCalledOnce();
});

it("pushes subagent-only count changes even when parent status stays idle", async () => {
	const t = await setup();
	const client = await t.authed();
	const subagents = { active: 2, waiting: 1, paused: 0, failed: 0 };
	writeFileSync(join(t.core.runDir, "live.json"), JSON.stringify({ ...t.snapshot, subagents }));
	await t.server.refresh();
	expect(await client.box.next("instances")).toMatchObject({ instances: [{ status: "idle", subagents }] });
});

it("opt-in alert watchers see unselected instances without history and can opt out", async () => {
	const s = await setup(true);
	const a = await s.authed();
	const b = await s.authed();
	a.send({ type: "watch_alerts", enabled: true });
	await vi.waitFor(() => expect(s.requests.some((r) => r.method === "hello")).toBe(true));
	// Wait for the initial hello to have settled using an RC ping-independent state boundary.
	await new Promise((r) => setTimeout(r, 30));
	expect(s.requests.some((r) => r.method === "history")).toBe(false);
	s.emit(1, { type: "status", status: "waiting_input" });
	expect(await a.box.next("alert")).toMatchObject({ alert: { kind: "input", sessionId: "session" } });
	expect(b.box.received.some((m) => m.type === "alert")).toBe(false);
	a.send({ type: "watch_alerts", enabled: false });
	a.send({ type: "ping", t: 1 });
	await a.box.next("pong");
	s.emit(2, { type: "status", status: "running" });
	s.emit(3, { type: "status", status: "waiting_input" });
	a.send({ type: "ping", t: 2 });
	await a.box.next("pong");
	expect(a.box.received.filter((m) => m.type === "alert")).toHaveLength(1);
});

it("returns an error for a GitHub query on an unknown Pi without disconnecting", async () => {
	const t = await setup();
	const c = await t.authed();
	c.send({ type: "github", requestId: "gh-1", instanceId: "unknown", query: { kind: "list" } });
	expect(await c.box.next("github_result")).toEqual({
		type: "github_result",
		requestId: "gh-1",
		ok: false,
		code: "not_found",
		message: "Pi instance not found",
	});
	c.send({ type: "ping", t: 42 });
	expect(await c.box.next("pong")).toMatchObject({ t: 42 });
});

it.each([
	{ kind: "issue", number: 0 },
	{ kind: "pr", number: "--web" },
	{ kind: "list", repo: "other/repo" },
	{ kind: "command", args: ["auth", "token"] },
])("closes malformed GitHub queries with protocol code: %o", async (query) => {
	const t = await setup();
	const c = await t.authed();
	c.send({ type: "github", requestId: "gh", instanceId: "known", query });
	expect(await c.closed).toBe(4400);
});

it.each([{ cwd: "/tmp" }, { path: "/tmp" }, { repo: "other/repo" }, { args: ["--web"] }, { requestId: "" }])(
	"rejects extra GitHub inputs and invalid requestId: %o",
	async (extra) => {
		const t = await setup();
		const c = await t.authed();
		c.send({ type: "github", requestId: "gh", instanceId: "known", query: { kind: "list" }, ...extra });
		expect(await c.closed).toBe(4400);
	},
);

it("webhooks watch only selected instances, deduplicate snapshots and suppress locally answered resolutions", async () => {
	const { createServer: httpServer } = await import("node:http");
	const { atomicWrite } = await import("../src/host/config.ts");
	const { markAnswered } = await import("../src/host/webhook.ts");
	const events: Record<string, unknown>[] = [];
	const sink = httpServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(Buffer.from(chunk));
		events.push(JSON.parse(Buffer.concat(chunks).toString()));
		res.writeHead(200).end();
	});
	await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
	cleanup.push(() => new Promise<void>((resolve) => sink.close(() => resolve())));
	const t = await setup(true);
	const dir = t.server.config.dir;
	atomicWrite(join(dir, "webhook.json"), {
		url: `http://127.0.0.1:${(sink.address() as { port: number }).port}`,
		headers: {},
		machine: "test",
	});
	await t.server.refresh();
	await vi.waitFor(() => expect(t.sockets.size).toBe(0));
	const question = { requestId: "question", kind: "select" as const, title: "Pick", options: ["one", "two"] };
	t.snapshot.pendingUI = [question];
	setWatch(dir, "live", true);
	await t.server.refresh();
	await vi.waitFor(() => expect(events).toHaveLength(1));
	expect(events[0]).toMatchObject({ event: "request.opened", requestId: "question" });
	for (const socket of t.sockets) socket.destroy();
	await vi.waitFor(() => expect(t.sockets.size).toBe(1));
	await t.server.refresh();
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(events).toHaveLength(1);
	markAnswered(dir, "live", "question");
	t.emit(1, { type: "ui_request_end", requestId: "question", by: "remote" });
	t.emit(2, { type: "ui_request", request: { ...question, requestId: "second" } });
	await vi.waitFor(() => expect(events).toHaveLength(2));
	t.emit(3, { type: "ui_request_end", requestId: "second", by: "tui" });
	await vi.waitFor(() => expect(events).toHaveLength(3));
	expect(events.map((event) => event.event)).toEqual(["request.opened", "request.opened", "request.resolved"]);
	expect(events[2]).toMatchObject({ requestId: "second", by: "tui", kind: "select" });
	const phone = await t.authed();
	phone.send({ type: "watch_alerts", enabled: true });
	phone.send({ type: "ping", t: 7 });
	await phone.box.next("pong");
	t.emit(4, { type: "agent_start" });
	t.emit(5, {
		type: "message_end",
		item: { kind: "assistant", entryId: "reply", text: "done", stopReason: "stop", toolCalls: [] },
	});
	t.emit(6, { type: "agent_settled", aborted: false });
	expect(await phone.box.next("alert")).toMatchObject({ alert: { kind: "complete" } });
	await vi.waitFor(() => expect(events).toHaveLength(4));
	expect(events[3]).toMatchObject({ event: "pi.finished", lastReply: "done" });
	t.emit(7, { type: "agent_start" });
	t.emit(8, {
		type: "message_end",
		item: { kind: "assistant", entryId: "fail", text: "", stopReason: "error", errorMessage: "failed", toolCalls: [] },
	});
	t.emit(9, { type: "agent_settled", aborted: false });
	await vi.waitFor(() => expect(events).toHaveLength(5));
	expect(events[4]).toMatchObject({ event: "pi.failed", error: "failed" });
	const run = {
		id: "child",
		backend: "example" as const,
		background: false,
		mode: "single" as const,
		state: "running" as const,
		children: [],
		actions: [],
	};
	t.emit(10, { type: "subagent_run", run });
	t.emit(11, { type: "subagent_run", run: { ...run, state: "waiting" } });
	await vi.waitFor(() => expect(events).toHaveLength(6));
	expect(events[5]).toMatchObject({ event: "pi.child", kind: "child_waiting" });
	await t.server.close();
	const restarted = new HostServer({ core: t.core, configDir: dir, listen: ["127.0.0.1"], port: 0, pollMs: 60_000 });
	await restarted.start();
	cleanup.push(() => restarted.close());
	await vi.waitFor(() => expect(t.sockets.size).toBe(1));
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(events).toHaveLength(6);
});

it("ignores invalid webhook files at start and refresh and isolates phone fanout from webhook errors", async () => {
	const t = await setup(true, (dir) => {
		for (const name of ["webhook-state.json", "webhook-watch", "webhook.json", "answered-here"])
			writeFileSync(join(dir, name), "{");
		writeFileSync(join(dir, "webhook-watch.lock"), "stale");
	});
	const a = await t.authed();
	a.send({ type: "watch_alerts", enabled: true });
	a.send({ type: "subscribe", instanceId: "live" });
	await a.box.next("subscribed");
	for (const value of ["null", "[]", '"wrong"', '{"headers":null}']) {
		for (const name of ["webhook-watch", "webhook.json", "answered-here"])
			writeFileSync(join(t.server.config.dir, name), value);
		await expect(t.server.refresh()).resolves.toBeUndefined();
	}
	const server = t.server as unknown as { webhookEvent: () => void };
	const broken = vi.spyOn(server, "webhookEvent").mockImplementation(() => {
		throw new Error("secret must not appear");
	});
	t.emit(1, { type: "status", status: "waiting_input" });
	expect(await a.box.next("alert")).toMatchObject({ alert: { kind: "input" } });
	expect(await a.box.next("event")).toMatchObject({ event: { type: "status" } });
	broken.mockRestore();
});

it("uses live tracked pending UI when a watched phone link is already connected", async () => {
	const { createServer: httpServer } = await import("node:http");
	const { atomicWrite } = await import("../src/host/config.ts");
	const events: Record<string, unknown>[] = [];
	const sink = httpServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const c of req) chunks.push(Buffer.from(c));
		events.push(JSON.parse(Buffer.concat(chunks).toString()));
		res.writeHead(200).end();
	});
	await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
	cleanup.push(() => new Promise<void>((resolve) => sink.close(() => resolve())));
	const t = await setup(true);
	const phone = await t.authed();
	phone.send({ type: "subscribe", instanceId: "live" });
	await phone.box.next("subscribed");
	const question = { requestId: "closed", kind: "select" as const, title: "Pick", options: ["one"] };
	t.emit(1, { type: "ui_request", request: question });
	t.emit(2, { type: "ui_request_end", requestId: "closed", by: "tui" });
	t.emit(3, { type: "ui_request", request: { ...question, requestId: "open" } });
	for (let i = 0; i < 3; i++) await phone.box.next("event");
	const dir = t.server.config.dir;
	atomicWrite(join(dir, "webhook.json"), {
		url: `http://127.0.0.1:${(sink.address() as { port: number }).port}`,
		machine: "test",
		headers: {},
	});
	setWatch(dir, "live", true);
	setWatch(dir, "gone", true);
	writeFileSync(join(dir, "webhook-watch.lock"), "stale");
	await t.server.refresh();
	await vi.waitFor(() => expect(events).toHaveLength(1));
	expect(events[0]).toMatchObject({ event: "request.opened", requestId: "open" });
	expect(watches(dir)).toEqual(["gone", "live"]);
});

it("continues queued resolution when persisting delivered-open state fails", async () => {
	const { createServer: httpServer } = await import("node:http");
	const { atomicWrite } = await import("../src/host/config.ts");
	const events: Record<string, unknown>[] = [];
	let release: (() => void) | undefined;
	const sink = httpServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const c of req) chunks.push(Buffer.from(c));
		events.push(JSON.parse(Buffer.concat(chunks).toString()));
		if (events.length === 1) release = () => res.writeHead(200).end();
		else res.writeHead(200).end();
	});
	await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
	cleanup.push(() => new Promise<void>((resolve) => sink.close(() => resolve())));
	const t = await setup(true);
	const dir = t.server.config.dir;
	mkdirSync(join(dir, "webhook-state.json"));
	atomicWrite(join(dir, "webhook.json"), {
		url: `http://127.0.0.1:${(sink.address() as { port: number }).port}`,
		machine: "test",
		headers: {},
	});
	setWatch(dir, "live", true);
	await t.server.refresh();
	await vi.waitFor(() => expect(t.sockets.size).toBe(1));
	await new Promise((resolve) => setTimeout(resolve, 40));
	t.emit(1, { type: "ui_request", request: { requestId: "r", kind: "input", title: "Question" } });
	await vi.waitFor(() => expect(release).toBeDefined());
	t.emit(2, { type: "ui_request_end", requestId: "r", by: "tui" });
	await new Promise((resolve) => setTimeout(resolve, 30));
	release?.();
	await vi.waitFor(() => expect(events).toHaveLength(2));
	expect(events[1]).toMatchObject({ event: "request.resolved", requestId: "r" });
});

it("CLI UI answers despite marker write failure and clears markers after rejected responses", async () => {
	const { spawn } = await import("node:child_process");
	const { fileURLToPath } = await import("node:url");
	const { answeredHere } = await import("../src/host/webhook.ts");
	const t = await setup(true);
	const run = (dir: string) =>
		new Promise<{ code: number | null; output: string }>((resolve, reject) => {
			const child = spawn(
				process.execPath,
				[fileURLToPath(new URL("../src/host/cli.ts", import.meta.url)), "ui", "live", "request", "answer"],
				{ env: { ...process.env, PIMATE_CONFIG_DIR: dir, PIMATE_RUN_DIR: t.core.runDir, PIMATE_ABDUCO: "/absent" } },
			);
			let output = "";
			child.stdout.on("data", (data) => {
				output += String(data);
			});
			child.stderr.on("data", (data) => {
				output += String(data);
			});
			child.on("error", reject);
			child.on("close", (code) => resolve({ code, output }));
		});
	const blocked = join(t.dir, "not-a-directory");
	writeFileSync(blocked, "x");
	const result = await run(blocked);
	expect(result.code).toBe(0);
	expect(result.output).toContain("webhook write answered-here.json failed");
	expect(t.requests.some((request) => request.method === "ui_respond")).toBe(true);
	writeFileSync(join(t.server.config.dir, "answered-here.lock"), "stale");
	let markerSeen = false;
	t.hooks.ui = (req, socket) => {
		markerSeen = answeredHere(t.server.config.dir, "live", "request");
		socket.write(
			encodeLine({ type: "response", id: req.id, ok: false, error: { code: "bad_request", message: "invalid label" } }),
		);
	};
	const rejected = await run(t.server.config.dir);
	expect(rejected.code).toBe(1);
	expect(rejected.output).toContain("invalid label");
	expect(markerSeen).toBe(true);
	expect(answeredHere(t.server.config.dir, "live", "request")).toBe(false);
});

it("keeps queued deliveries after an instance is unwatched", async () => {
	const { createServer: httpServer } = await import("node:http");
	const { atomicWrite } = await import("../src/host/config.ts");
	const events: Record<string, unknown>[] = [];
	let status = 401;
	const sink = httpServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const c of req) chunks.push(Buffer.from(c));
		events.push(JSON.parse(Buffer.concat(chunks).toString()));
		res.writeHead(status).end();
	});
	await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
	cleanup.push(() => new Promise<void>((resolve) => sink.close(() => resolve())));
	const t = await setup(true);
	const dir = t.server.config.dir;
	atomicWrite(join(dir, "webhook.json"), {
		url: `http://127.0.0.1:${(sink.address() as { port: number }).port}`,
		headers: {},
		machine: "test",
	});
	setWatch(dir, "live", true);
	await t.server.refresh();
	await vi.waitFor(() => expect(t.sockets.size).toBe(1));
	await new Promise((resolve) => setTimeout(resolve, 40));
	t.emit(1, { type: "agent_start" });
	t.emit(2, {
		type: "message_end",
		item: { kind: "assistant", entryId: "reply", text: "done", stopReason: "stop", toolCalls: [] },
	});
	t.emit(3, { type: "agent_settled", aborted: false });
	await vi.waitFor(() => expect(events).toHaveLength(1));
	await new Promise((resolve) => setTimeout(resolve, 30));
	setWatch(dir, "live", false);
	await t.server.refresh();
	status = 200;
	const delivery = (t.server as unknown as { delivery: { retry: () => Promise<void> } }).delivery;
	await delivery.retry();
	expect(events).toHaveLength(2);
	expect(events[1]).toMatchObject({ event: "pi.finished" });
});

it("CLI watch ignores stale locks and reports only live instance ids", async () => {
	const { spawn } = await import("node:child_process");
	const { fileURLToPath } = await import("node:url");
	const t = await setup(true);
	const dir = t.server.config.dir;
	setWatch(dir, "gone", true);
	writeFileSync(join(dir, "webhook-watch.lock"), "stale");
	const run = (action: string) =>
		new Promise<{ code: number | null; output: string }>((resolve, reject) => {
			const child = spawn(
				process.execPath,
				[fileURLToPath(new URL("../src/host/cli.ts", import.meta.url)), "webhook", action, "live"],
				{ env: { ...process.env, PIMATE_CONFIG_DIR: dir, PIMATE_RUN_DIR: t.core.runDir, PIMATE_ABDUCO: "/absent" } },
			);
			let output = "";
			child.stdout.on("data", (data) => {
				output += String(data);
			});
			child.stderr.on("data", (data) => {
				output += String(data);
			});
			child.on("error", reject);
			child.on("close", (code) => resolve({ code, output }));
		});
	const watched = await run("watch");
	expect(watched.code).toBe(0);
	expect(JSON.parse(watched.output).watched).toEqual(["live"]);
	setWatch(dir, "live", true);
	setWatch(dir, "gone", true);
	const unwatched = await run("unwatch");
	expect(unwatched.code).toBe(0);
	expect(JSON.parse(unwatched.output).watched).toEqual([]);
});

it.each([false, true])(
	"handles held resolutions after the watched instance exits (answered here: %s)",
	async (answeredHere) => {
		const { createServer: httpServer } = await import("node:http");
		const { atomicWrite } = await import("../src/host/config.ts");
		const events: Record<string, unknown>[] = [];
		let release: (() => void) | undefined;
		const sink = httpServer(async (req, res) => {
			const chunks: Buffer[] = [];
			for await (const c of req) chunks.push(Buffer.from(c));
			events.push(JSON.parse(Buffer.concat(chunks).toString()));
			if (events.length === 1) release = () => res.writeHead(401).end();
			else res.writeHead(200).end();
		});
		await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
		cleanup.push(() => new Promise<void>((resolve) => sink.close(() => resolve())));
		const t = await setup(true);
		const dir = t.server.config.dir;
		atomicWrite(join(dir, "webhook.json"), {
			url: `http://127.0.0.1:${(sink.address() as { port: number }).port}`,
			headers: {},
			machine: "desk",
		});
		setWatch(dir, "live", true);
		await t.server.refresh();
		await vi.waitFor(() => expect(t.sockets.size).toBe(1));
		await new Promise((resolve) => setTimeout(resolve, 40));
		t.emit(1, { type: "ui_request", request: { requestId: "question", kind: "input", title: "Question" } });
		await vi.waitFor(() => expect(release).toBeDefined());
		t.emit(2, { type: "ui_request_end", requestId: "question", by: "tui" });
		await new Promise((resolve) => setTimeout(resolve, 40));
		release?.();
		const delivery = (t.server as unknown as { delivery: { retry: () => Promise<void>; queue: unknown[] } }).delivery;
		await vi.waitFor(() => expect(delivery.queue).toHaveLength(1));
		if (answeredHere) {
			const { markAnswered } = await import("../src/host/webhook.ts");
			markAnswered(dir, "live", "question");
		}
		setWatch(dir, "live", false);
		rmSync(join(t.core.runDir, "live.json"), { force: true });
		for (const socket of t.sockets) socket.destroy();
		await t.server.refresh();
		await delivery.retry();
		if (answeredHere) {
			await new Promise((resolve) => setTimeout(resolve, 60));
			expect(events.map((e) => e.event)).toEqual(["request.opened", "request.opened"]);
		} else {
			await vi.waitFor(() => expect(events).toHaveLength(3));
			expect(events.map((e) => e.event)).toEqual(["request.opened", "request.opened", "request.resolved"]);
			expect(events[2]).toMatchObject({
				requestId: "question",
				instanceId: "live",
				sessionId: "session",
				by: "tui",
				kind: "input",
				cwd: t.dir,
			});
		}
	},
);
