import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type AddressInfo, isIP } from "node:net";
import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";
import {
	DEFAULT_HOST_PORT,
	type EventMessage,
	HOST_PROTOCOL_VERSION,
	HostCloseCode,
	type HostMessage,
	type InstanceSummary,
	type Request,
} from "@pimate/protocol";
import { WebSocket, WebSocketServer } from "ws";
import { validInstanceId } from "../runtime.ts";
import type { RcClient } from "./client.ts";
import { HostConfig, PairingError } from "./config.ts";
import { HostCore } from "./index.ts";

export function listenAddresses(interfaces: Record<string, NetworkInterfaceInfo[] | undefined>): string[] {
	const addresses = ["127.0.0.1"];
	for (const entry of Object.values(interfaces).flatMap((entries) => entries ?? [])) {
		const address = entry.address;
		const octets = address.split(".").map(Number);
		if (
			(isIP(address) === 4 && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
			(isIP(address) === 6 && /^fd7a:115c:a1e0:/i.test(address))
		)
			addresses.push(address);
	}
	return [...new Set(addresses)];
}
const MAX_BUFFER = 8 * 1024 * 1024;
type Peer = { ws: WebSocket; deviceId?: string; timer: NodeJS.Timeout };
type Subscription = { ready: boolean; buffer: EventMessage[]; bytes: number; generation: number; seq: number };
type Link = {
	id: string;
	client?: RcClient;
	pendingClient?: RcClient;
	connecting?: Promise<RcClient>;
	subs: Map<Peer, Subscription>;
	pending?: EventMessage;
	deltaTimer?: NodeJS.Timeout;
	retryTimer?: NodeJS.Timeout;
	idleTimer?: NodeJS.Timeout;
	backoff: number;
	requests: number;
};
export interface HostServerOptions {
	core?: HostCore;
	configDir?: string;
	port?: number;
	listen?: string[];
	pollMs?: number;
	authTimeoutMs?: number;
}
export class HostServer {
	readonly core: HostCore;
	readonly config: HostConfig;
	readonly options: HostServerOptions;
	private servers: Server[] = [];
	private wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
	private peers = new Set<Peer>();
	private links = new Map<string, Link>();
	private instances: InstanceSummary[] = [];
	private pollTimer?: NodeJS.Timeout;
	private polling = false;
	private stopped = false;
	constructor(options: HostServerOptions = {}) {
		this.options = options;
		this.core = options.core ?? new HostCore();
		this.config = new HostConfig(options.configDir);
		this.wss.on("connection", (ws) => this.accept(ws));
	}
	async start(): Promise<{ address: string; port: number }[]> {
		await this.refresh();
		const addresses = this.options.listen ?? listenAddresses(networkInterfaces());
		if (!this.options.listen && addresses.length === 1)
			console.warn("No Tailscale address found; listening on loopback only.");
		const bound: { address: string; port: number }[] = [];
		try {
			for (const address of addresses) {
				const server = createServer((req, res) => {
					void this.http(req, res);
				});
				this.servers.push(server);
				server.on("upgrade", (req, socket, head) => {
					if (req.method !== "GET" || req.url !== "/ws") {
						socket.destroy();
						return;
					}
					this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws, req));
				});
				await new Promise<void>((resolve, reject) => {
					server.once("error", reject);
					server.listen(this.options.port ?? DEFAULT_HOST_PORT, address, () => {
						server.off("error", reject);
						resolve();
					});
				});
				bound.push({ address, port: (server.address() as AddressInfo).port });
			}
		} catch (error) {
			await this.close();
			throw error;
		}
		this.pollTimer = setInterval(() => {
			void this.refresh().catch(() => {});
		}, this.options.pollMs ?? 1500);
		return bound;
	}
	private async http(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const reply = (status: number, body: unknown) => {
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify(body));
		};
		if (req.method === "GET" && req.url === "/health") {
			reply(200, { ok: true, protocol: HOST_PROTOCOL_VERSION });
			return;
		}
		if (req.method !== "POST" || req.url !== "/pair") {
			reply(404, {});
			return;
		}
		if (req.headers.origin || req.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
			reply(400, { error: "bad_request" });
			req.resume();
			return;
		}
		try {
			let body = "";
			let size = 0;
			for await (const chunk of req) {
				size += Buffer.byteLength(chunk);
				if (size > 4096) {
					reply(400, { error: "bad_request" });
					return;
				}
				body += chunk.toString();
			}
			const value = JSON.parse(body);
			if (
				!value ||
				typeof value.code !== "string" ||
				!/^[A-Za-z0-9_-]{16,128}$/.test(value.code) ||
				typeof value.deviceName !== "string" ||
				!value.deviceName.trim() ||
				value.deviceName.length > 200
			) {
				reply(400, { error: "bad_request" });
				return;
			}
			reply(200, this.config.pair(value.code, value.deviceName.trim()));
		} catch (error) {
			if (error instanceof PairingError) reply(error.code === "expired_code" ? 410 : 401, { error: error.code });
			else reply(400, { error: "bad_request" });
		}
	}
	private send(peer: Peer, message: HostMessage): void {
		if (peer.ws.readyState !== WebSocket.OPEN) return;
		if (peer.ws.bufferedAmount > MAX_BUFFER) {
			peer.ws.close(1009, "Slow consumer");
			return;
		}
		peer.ws.send(JSON.stringify(message));
	}
	private accept(ws: WebSocket): void {
		const peer: Peer = {
			ws,
			timer: setTimeout(() => ws.close(HostCloseCode.authTimeout), this.options.authTimeoutMs ?? 5000),
		};
		this.peers.add(peer);
		ws.on("error", () => ws.terminate());
		ws.on("close", () => {
			clearTimeout(peer.timer);
			this.peers.delete(peer);
			for (const link of this.links.values()) {
				link.subs.delete(peer);
				this.idle(link);
			}
		});
		ws.on("message", (data, binary) => {
			if (ws.readyState !== WebSocket.OPEN) return;
			try {
				if (binary) throw new Error("Text required");
				const message = JSON.parse(data.toString());
				if (!message || typeof message !== "object") throw new Error("Object required");
				if (!peer.deviceId) {
					clearTimeout(peer.timer);
					if (
						message.type !== "auth" ||
						typeof message.token !== "string" ||
						!message.app ||
						typeof message.app.version !== "string" ||
						typeof message.app.platform !== "string"
					) {
						this.send(peer, { type: "auth_error", code: "bad_request" });
						ws.close(HostCloseCode.protocol);
						return;
					}
					if (message.protocol !== HOST_PROTOCOL_VERSION) {
						this.send(peer, { type: "auth_error", code: "protocol_mismatch" });
						ws.close(HostCloseCode.protocol);
						return;
					}
					const device = this.config.authenticate(message.token);
					if (!device) {
						this.send(peer, { type: "auth_error", code: "invalid_token" });
						ws.close(HostCloseCode.authFailed);
						return;
					}
					peer.deviceId = device.deviceId;
					this.config.touch(device.deviceId);
					this.send(peer, {
						type: "auth_ok",
						deviceId: device.deviceId,
						host: {
							...this.config.host,
							protocol: HOST_PROTOCOL_VERSION,
							version: "0.0.0",
							platform: process.platform,
						},
					});
					this.send(peer, { type: "instances", instances: this.instances });
					return;
				}
				if (message.type === "ping" && typeof message.t === "number") {
					this.send(peer, { type: "pong", t: message.t });
					return;
				}
				if (typeof message.instanceId !== "string" || !validInstanceId(message.instanceId))
					throw new Error("Invalid instance");
				if (message.type === "subscribe") {
					void this.subscribe(peer, message.instanceId);
					return;
				}
				if (message.type === "unsubscribe") {
					const link = this.links.get(message.instanceId);
					if (link) {
						link.subs.delete(peer);
						this.idle(link);
					}
					return;
				}
				if (message.type === "rc") {
					const r = message.request;
					if (
						!r ||
						typeof r !== "object" ||
						typeof r.id !== "string" ||
						!r.id ||
						r.id.length > 200 ||
						typeof r.method !== "string" ||
						(r.params !== undefined && (!r.params || typeof r.params !== "object" || Array.isArray(r.params))) ||
						(r.expectInstanceId !== undefined && typeof r.expectInstanceId !== "string") ||
						(r.expectSessionId !== undefined && typeof r.expectSessionId !== "string")
					)
						throw new Error("Invalid request");
					void this.forward(peer, message.instanceId, r);
					return;
				}
				throw new Error("Unknown message");
			} catch {
				ws.close(HostCloseCode.protocol);
			}
		});
	}
	async refresh(): Promise<void> {
		if (this.polling || this.stopped) return;
		this.polling = true;
		try {
			const devices = this.config.devices();
			for (const peer of this.peers) {
				if (peer.ws.bufferedAmount > MAX_BUFFER) peer.ws.close(1009, "Slow consumer");
				if (peer.deviceId && !devices.some((d) => d.deviceId === peer.deviceId)) peer.ws.close(HostCloseCode.revoked);
				else if (peer.deviceId) this.config.touch(peer.deviceId);
			}
			const list = await this.core.list();
			if (this.stopped) return;
			const next = list
				.map(({ instanceId, cwd, origin, abducoSession, pcAttached, session, status, startedAt, updatedAt }) => ({
					instanceId,
					cwd,
					origin,
					abducoSession,
					pcAttached,
					session,
					status,
					startedAt,
					updatedAt,
				}))
				.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
			for (const link of this.links.values())
				if (!next.some((i) => i.instanceId === link.id)) {
					for (const peer of link.subs.keys()) this.send(peer, { type: "instance_gone", instanceId: link.id });
					this.drop(link);
				}
			if (JSON.stringify(next) !== JSON.stringify(this.instances)) {
				this.instances = next;
				for (const peer of this.peers) if (peer.deviceId) this.send(peer, { type: "instances", instances: next });
			}
		} finally {
			this.polling = false;
		}
	}
	private link(id: string): Link {
		let link = this.links.get(id);
		if (!link) {
			link = { id, subs: new Map(), backoff: 250, requests: 0 };
			this.links.set(id, link);
		}
		clearTimeout(link.idleTimer);
		link.idleTimer = undefined;
		return link;
	}
	private async connect(link: Link): Promise<RcClient> {
		if (link.client) return link.client;
		if (link.connecting) return link.connecting;
		link.connecting = (async () => {
			const client = this.core.client(link.id);
			link.pendingClient = client;
			client.onEvent((event) => this.event(link, event));
			await client.connect();
			if (this.stopped || this.links.get(link.id) !== link) {
				client.close();
				throw new Error("Link closed");
			}
			link.client = client;
			link.backoff = 250;
			client.onClose(() => {
				if (link.client !== client) return;
				link.client = undefined;
				this.flush(link);
				for (const sub of link.subs.values()) {
					sub.ready = false;
					sub.buffer = [];
					sub.bytes = 0;
					sub.generation++;
				}
				this.reconnect(link);
			});
			return client;
		})();
		try {
			return await link.connecting;
		} finally {
			link.connecting = undefined;
			link.pendingClient = undefined;
		}
	}
	private reconnect(link: Link): void {
		if (this.stopped || !link.subs.size || this.links.get(link.id) !== link || link.retryTimer) return;
		link.retryTimer = setTimeout(async () => {
			link.retryTimer = undefined;
			try {
				await this.connect(link);
				await Promise.all([...link.subs.keys()].map((peer) => this.resync(link, peer)));
			} catch {
				link.backoff = Math.min(link.backoff * 2, 5000);
				this.reconnect(link);
			}
		}, link.backoff);
	}
	private async subscribe(peer: Peer, id: string): Promise<void> {
		if (!this.instances.some((i) => i.instanceId === id)) {
			this.send(peer, { type: "subscribe_error", instanceId: id, code: "not_found" });
			return;
		}
		const link = this.link(id);
		link.subs.set(peer, { ready: false, buffer: [], bytes: 0, generation: 0, seq: -1 });
		try {
			await this.resync(link, peer);
		} catch {
			this.send(peer, { type: "subscribe_error", instanceId: id, code: "unreachable" });
			this.reconnect(link);
		}
	}
	private async resync(link: Link, peer: Peer): Promise<void> {
		const sub = link.subs.get(peer);
		if (!sub) return;
		sub.ready = false;
		sub.buffer = [];
		sub.bytes = 0;
		const generation = ++sub.generation;
		const client = await this.connect(link);
		const { snapshot } = await client.request("hello", {});
		const history = await client.request(
			"history",
			{},
			snapshot.session ? { expectSessionId: snapshot.session.id } : {},
		);
		if (history.session?.id !== snapshot.session?.id) throw new Error("Session changed during resync");
		if (link.subs.get(peer) !== sub || sub.generation !== generation || link.client !== client) return;
		// A pending coalesced delta may straddle snapshot.seq: replay this subscriber's raw buffer instead.
		this.flush(link);
		this.send(peer, { type: "subscribed", instanceId: link.id, snapshot, history });
		sub.seq = snapshot.seq;
		for (const event of sub.buffer)
			if (event.seq > sub.seq) {
				this.send(peer, event);
				sub.seq = event.seq;
			}
		sub.buffer = [];
		sub.bytes = 0;
		sub.ready = true;
	}
	private event(link: Link, event: EventMessage): void {
		for (const [peer, sub] of link.subs)
			if (!sub.ready) {
				sub.bytes += Buffer.byteLength(JSON.stringify(event));
				if (sub.bytes > MAX_BUFFER) {
					peer.ws.close(1009, "Resync overflow");
					link.subs.delete(peer);
				} else sub.buffer.push(event);
			}
		const delta = event.event.type === "text_delta" || event.event.type === "thinking_delta";
		if (
			delta &&
			link.pending &&
			link.pending.event.type === event.event.type &&
			link.pending.sessionId === event.sessionId &&
			"delta" in link.pending.event &&
			"delta" in event.event
		) {
			link.pending = { ...event, event: { ...event.event, delta: link.pending.event.delta + event.event.delta } };
			return;
		}
		this.flush(link);
		if (delta) {
			link.pending = event;
			link.deltaTimer = setTimeout(() => this.flush(link), 50);
		} else this.fanout(link, event);
	}
	private fanout(link: Link, event: EventMessage): void {
		for (const [peer, sub] of link.subs)
			if (sub.ready && event.seq > sub.seq) {
				this.send(peer, event);
				sub.seq = event.seq;
			}
	}
	private flush(link: Link): void {
		clearTimeout(link.deltaTimer);
		if (link.pending) {
			this.fanout(link, link.pending);
			link.pending = undefined;
		}
	}
	private async forward(peer: Peer, id: string, request: Request): Promise<void> {
		if (!this.instances.some((i) => i.instanceId === id)) {
			this.send(peer, {
				type: "rc_result",
				instanceId: id,
				response: { type: "response", id: request.id, ok: false, error: { code: "not_found" } },
			});
			return;
		}
		const link = this.link(id);
		link.requests++;
		try {
			const client = await this.connect(link);
			this.send(peer, { type: "rc_result", instanceId: id, response: await client.send(request) });
		} catch {
			this.send(peer, {
				type: "rc_result",
				instanceId: id,
				response: {
					type: "response",
					id: request.id,
					ok: false,
					error: { code: "internal", message: "RC transport failed; outcome unknown, not retried" },
				},
			});
		} finally {
			link.requests--;
			this.idle(link);
		}
	}
	private idle(link: Link): void {
		if (link.subs.size || link.requests || link.idleTimer) return;
		link.idleTimer = setTimeout(() => {
			if (!link.subs.size && !link.requests) this.drop(link);
		}, 1000);
	}
	private drop(link: Link): void {
		clearTimeout(link.deltaTimer);
		clearTimeout(link.retryTimer);
		clearTimeout(link.idleTimer);
		link.client?.close();
		link.pendingClient?.close();
		link.subs.clear();
		this.links.delete(link.id);
	}
	async close(): Promise<void> {
		this.stopped = true;
		clearInterval(this.pollTimer);
		for (const peer of this.peers) {
			clearTimeout(peer.timer);
			peer.ws.terminate();
		}
		for (const link of this.links.values()) this.drop(link);
		this.wss.close();
		await Promise.all(
			this.servers.map(
				(server) =>
					new Promise<void>((resolve) => {
						server.close(() => resolve());
						server.closeAllConnections();
					}),
			),
		);
	}
}
