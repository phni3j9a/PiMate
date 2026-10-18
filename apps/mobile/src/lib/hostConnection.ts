/**
 * One WebSocket connection to a paired Host (docs: packages/protocol/src/host.ts, packages/pimate/README.md).
 *
 * - `ws://<address>/ws`; the first message is `auth`. `auth_error` / close 4401 / 4403 stop for good
 *   (the host needs re-pairing). Everything else reconnects with capped exponential backoff + jitter (1 s → 30 s).
 * - A ping every ~20 s; a missing pong marks the socket dead. `foreground()` reconnects immediately.
 * - Holds at most one desired subscription and re-sends it after every (re)connect.
 * - `rc()` forwards one request and resolves with the matching `rc_result`. A request that was sent but not answered
 *   when the socket drops rejects with `outcome_unknown`; it is never re-sent.
 * - `folders()` / `dirs()` / `spawn()` are Host-level requests matched by requestId, with the same failure semantics.
 * Pure TS: the WebSocket constructor and timers are injected.
 */
import {
	type AppMessage,
	HOST_PROTOCOL_VERSION,
	HostCloseCode,
	type HostInfo,
	type HostMessage,
	type InstanceSummary,
	type Request,
	type Response,
	type SpawnParams,
} from "@pimate/protocol";

type FoldersResult = Extract<HostMessage, { type: "folders_result" }>;
type DirsResult = Extract<HostMessage, { type: "dirs_result" }>;
type SpawnResult = Extract<HostMessage, { type: "spawn_result" }>;

export type ConnectionState = "idle" | "connecting" | "connected" | "offline" | "auth_failed";
export type AuthFailure = "invalid_token" | "protocol_mismatch" | "bad_request" | "revoked";

export interface SocketLike {
	readonly readyState: number;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	onopen: ((ev: unknown) => void) | null;
	onmessage: ((ev: { data: unknown }) => void) | null;
	onclose: ((ev: { code?: number; reason?: string }) => void) | null;
	onerror: ((ev: unknown) => void) | null;
}

export interface ConnectionDeps {
	createSocket(url: string): SocketLike;
	app: { version: string; platform: string };
	setTimeout?: (fn: () => void, ms: number) => unknown;
	clearTimeout?: (handle: unknown) => void;
	now?: () => number;
	random?: () => number;
	pingIntervalMs?: number;
	pongTimeoutMs?: number;
	/** Max time from opening the socket to `auth_ok`. */
	authTimeoutMs?: number;
}

export class RcError extends Error {
	readonly code: "not_connected" | "outcome_unknown";
	constructor(code: "not_connected" | "outcome_unknown") {
		super(code);
		this.code = code;
	}
}

export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;

/** Delay before reconnect attempt `attempt` (0-based): 1 s, 2 s, 4 s … capped at 30 s, ±20 % jitter. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
	const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempt, 10));
	return Math.min(BACKOFF_MAX_MS, Math.round(base * (0.8 + 0.4 * random())));
}

const OPEN = 1;

export class HostConnection {
	readonly address: string;
	private readonly token: string;
	private readonly deps: Required<Omit<ConnectionDeps, "createSocket" | "app">> &
		Pick<ConnectionDeps, "createSocket" | "app">;

	state: ConnectionState = "idle";
	authFailure: AuthFailure | null = null;
	info: HostInfo | null = null;
	instances: InstanceSummary[] = [];
	/** True once the current connection has delivered its instance list (it arrives after auth_ok). */
	instancesReceived = false;
	/** Number of consecutive failed attempts since the last successful auth. */
	attempt = 0;
	/** Local time of the next scheduled reconnect, while offline. */
	nextRetryAt: number | null = null;

	private socket: SocketLike | null = null;
	private authed = false;
	private stopped = true;
	private retryTimer: unknown = null;
	private pingTimer: unknown = null;
	private pongTimer: unknown = null;
	private authTimer: unknown = null;
	private subscription: string | null = null;
	private alertsEnabled = false;

	setAlertsEnabled(enabled: boolean): void {
		this.alertsEnabled = enabled;
		if (this.authed && this.info?.alerts) this.send({ type: "watch_alerts", enabled });
	}

	private pending = new Map<string, { resolve: (r: Response) => void; reject: (e: RcError) => void }>();
	private hostPending = new Map<string, { resolve: (r: never) => void; reject: (e: RcError) => void }>();
	private stateListeners = new Set<() => void>();
	private messageListeners = new Set<(msg: HostMessage) => void>();

	constructor(address: string, token: string, deps: ConnectionDeps) {
		this.address = address;
		this.token = token;
		this.deps = {
			setTimeout: (fn, ms) => setTimeout(fn, ms),
			clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
			now: () => Date.now(),
			random: Math.random,
			pingIntervalMs: 20_000,
			pongTimeoutMs: 10_000,
			authTimeoutMs: 10_000,
			...(Object.fromEntries(Object.entries(deps).filter(([, v]) => v !== undefined)) as ConnectionDeps),
		};
	}

	/** Called on state / instance list changes. */
	onChange(listener: () => void): () => void {
		this.stateListeners.add(listener);
		return () => this.stateListeners.delete(listener);
	}

	/** Called for every Host message after auth except pong / rc_result. */
	onMessage(listener: (msg: HostMessage) => void): () => void {
		this.messageListeners.add(listener);
		return () => this.messageListeners.delete(listener);
	}

	start(): void {
		if (!this.stopped || this.state === "auth_failed") return;
		this.stopped = false;
		this.connect();
	}

	stop(): void {
		this.stopped = true;
		this.clearTimers();
		this.teardown();
		this.failPending();
		this.setState("idle");
	}

	/** App returned to the foreground: reconnect now instead of waiting for the backoff, or verify a live socket. */
	foreground(): void {
		if (this.stopped || this.state === "auth_failed") return;
		if (this.state === "offline") {
			this.attempt = 0;
			this.clear("retryTimer");
			this.connect();
		} else if (this.state === "connected") this.ping();
	}

	/** Reconnect right away (user tapped "retry"). */
	retryNow(): void {
		if (this.stopped || this.state !== "offline") return;
		this.clear("retryTimer");
		this.connect();
	}

	/** The instance shown in the chat; `null` to unsubscribe. Survives reconnects. */
	setSubscription(instanceId: string | null): void {
		const prev = this.subscription;
		if (prev === instanceId) return;
		this.subscription = instanceId;
		if (!this.authed) return;
		if (prev) this.send({ type: "unsubscribe", instanceId: prev });
		if (instanceId) this.send({ type: "subscribe", instanceId });
	}

	/** Ask for a fresh `subscribed` (after session_changed). */
	resubscribe(): void {
		if (this.authed && this.subscription) this.send({ type: "subscribe", instanceId: this.subscription });
	}

	get subscribedInstance(): string | null {
		return this.subscription;
	}

	rc(instanceId: string, request: Request): Promise<Response> {
		if (!this.authed || !this.socket || this.socket.readyState !== OPEN)
			return Promise.reject(new RcError("not_connected"));
		return new Promise<Response>((resolve, reject) => {
			this.pending.set(request.id, { resolve, reject });
			if (!this.send({ type: "rc", instanceId, request })) {
				this.pending.delete(request.id);
				reject(new RcError("not_connected"));
			}
		});
	}

	/** Folder candidates for a new Pi. */
	folders(requestId: string): Promise<FoldersResult> {
		return this.hostRequest<FoldersResult>({ type: "folders", requestId });
	}

	/** Subfolder names for completing a path; only when `info.dirs` (older Hosts close on unknown messages). */
	dirs(requestId: string, path: string): Promise<DirsResult> {
		return this.hostRequest<DirsResult>({ type: "dirs", requestId, path });
	}

	/** Starts a new Pi on this Host. Never retried: a dropped socket rejects with `outcome_unknown`. */
	spawn(requestId: string, params: SpawnParams): Promise<SpawnResult> {
		return this.hostRequest<SpawnResult>({ type: "spawn", requestId, params });
	}

	private hostRequest<T>(msg: Extract<AppMessage, { requestId: string }>): Promise<T> {
		if (!this.authed || !this.socket || this.socket.readyState !== OPEN)
			return Promise.reject(new RcError("not_connected"));
		return new Promise<T>((resolve, reject) => {
			this.hostPending.set(msg.requestId, { resolve: resolve as (r: never) => void, reject });
			if (!this.send(msg)) {
				this.hostPending.delete(msg.requestId);
				reject(new RcError("not_connected"));
			}
		});
	}

	// ------------------------------------------------------------ internals

	private setState(state: ConnectionState): void {
		this.state = state;
		this.emitChange();
	}

	private emitChange(): void {
		for (const l of this.stateListeners) l();
	}

	private send(msg: AppMessage): boolean {
		const s = this.socket;
		if (!s || s.readyState !== OPEN) return false;
		try {
			s.send(JSON.stringify(msg));
			return true;
		} catch {
			return false;
		}
	}

	private clear(name: "retryTimer" | "pingTimer" | "pongTimer" | "authTimer"): void {
		if (this[name] !== null) this.deps.clearTimeout(this[name]);
		this[name] = null;
	}

	private clearTimers(): void {
		this.clear("retryTimer");
		this.clear("pingTimer");
		this.clear("pongTimer");
		this.clear("authTimer");
		this.nextRetryAt = null;
	}

	private connect(): void {
		this.teardown();
		this.nextRetryAt = null;
		this.instancesReceived = false;
		this.setState("connecting");
		let socket: SocketLike;
		try {
			socket = this.deps.createSocket(`ws://${this.address}/ws`);
		} catch {
			this.handleClose(undefined);
			return;
		}
		this.socket = socket;
		this.authTimer = this.deps.setTimeout(() => {
			this.authTimer = null;
			if (this.socket === socket && !this.authed) this.dead();
		}, this.deps.authTimeoutMs);
		socket.onopen = () => {
			if (this.socket !== socket) return;
			this.send({ type: "auth", token: this.token, protocol: HOST_PROTOCOL_VERSION, app: this.deps.app });
		};
		socket.onmessage = (ev) => {
			if (this.socket !== socket) return;
			let msg: HostMessage;
			try {
				msg = JSON.parse(String(ev.data));
			} catch {
				return;
			}
			if (msg && typeof msg === "object") this.handleMessage(msg);
		};
		socket.onerror = () => {
			// onclose follows; nothing to do here.
		};
		socket.onclose = (ev) => {
			if (this.socket !== socket) return;
			this.handleClose(ev?.code);
		};
	}

	private handleMessage(msg: HostMessage): void {
		if (!this.authed) {
			if (msg.type === "auth_ok") {
				this.authed = true;
				this.attempt = 0;
				this.authFailure = null;
				this.info = msg.host;
				this.setAlertsEnabled(this.alertsEnabled);
				this.clear("authTimer");
				this.schedulePing();
				if (this.subscription) this.send({ type: "subscribe", instanceId: this.subscription });
				this.setState("connected");
			} else if (msg.type === "auth_error") {
				this.failAuth(msg.code);
			}
			return;
		}
		switch (msg.type) {
			case "pong":
				this.clear("pongTimer");
				return;
			case "instances":
				this.instances = Array.isArray(msg.instances) ? msg.instances : [];
				this.instancesReceived = true;
				this.emitChange();
				return;
			case "rc_result": {
				const id = msg.response?.id;
				const p = typeof id === "string" ? this.pending.get(id) : undefined;
				if (p && id) {
					this.pending.delete(id);
					p.resolve(msg.response);
				}
				return;
			}
			case "folders_result":
			case "dirs_result":
			case "spawn_result": {
				const p = this.hostPending.get(msg.requestId);
				if (p) {
					this.hostPending.delete(msg.requestId);
					p.resolve(msg as never);
				}
				return;
			}
		}
		for (const l of this.messageListeners) l(msg);
	}

	private failAuth(code: AuthFailure): void {
		this.authFailure = code;
		this.stopped = true;
		this.clearTimers();
		this.teardown();
		this.failPending();
		this.setState("auth_failed");
	}

	private handleClose(code: number | undefined): void {
		if (code === HostCloseCode.authFailed || code === HostCloseCode.revoked) {
			this.failAuth(code === HostCloseCode.revoked ? "revoked" : (this.authFailure ?? "invalid_token"));
			return;
		}
		const wasAuthed = this.authed;
		this.teardown();
		this.failPending();
		if (this.stopped) return;
		if (!wasAuthed) this.attempt++;
		else this.attempt = 0;
		const delay = wasAuthed ? backoffDelay(0, this.deps.random) : backoffDelay(this.attempt - 1, this.deps.random);
		this.nextRetryAt = this.deps.now() + delay;
		this.retryTimer = this.deps.setTimeout(() => {
			this.retryTimer = null;
			this.connect();
		}, delay);
		this.setState("offline");
	}

	/** The socket stopped answering: drop it without waiting for the OS to notice. */
	private dead(): void {
		const s = this.socket;
		if (!s) return;
		this.handleClose(undefined);
		try {
			s.close();
		} catch {
			// already closed
		}
	}

	private schedulePing(): void {
		this.clear("pingTimer");
		this.pingTimer = this.deps.setTimeout(() => {
			this.pingTimer = null;
			this.ping();
		}, this.deps.pingIntervalMs);
	}

	private ping(): void {
		if (!this.authed || this.pongTimer !== null) return;
		if (!this.send({ type: "ping", t: this.deps.now() })) {
			this.dead();
			return;
		}
		this.pongTimer = this.deps.setTimeout(() => {
			this.pongTimer = null;
			this.dead();
		}, this.deps.pongTimeoutMs);
		this.schedulePing();
	}

	private teardown(): void {
		this.clear("pingTimer");
		this.clear("pongTimer");
		this.clear("authTimer");
		const s = this.socket;
		this.socket = null;
		this.authed = false;
		if (s) {
			s.onopen = null;
			s.onmessage = null;
			s.onclose = null;
			s.onerror = null;
			if (s.readyState <= OPEN) {
				try {
					s.close();
				} catch {
					// ignore
				}
			}
		}
	}

	private failPending(): void {
		const pending = [...this.pending.values(), ...this.hostPending.values()];
		this.pending.clear();
		this.hostPending.clear();
		for (const p of pending) p.reject(new RcError("outcome_unknown"));
	}
}
