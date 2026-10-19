/**
 * Host <-> mobile app protocol (M1).
 *
 * Transport
 * - HTTP + WebSocket served by the Host on its Tailscale addresses and loopback only (Tailscale/WireGuard
 *   provides transport encryption; the Host never listens on other interfaces unless explicitly configured).
 * - Pairing: `POST /pair` with a single-use code obtained from the pairing URL (QR) -> long-lived device token.
 * - `GET /ws` upgrades to a WebSocket. One JSON message per text frame. The first app message must be `auth`.
 *
 * Semantics
 * - The Host keeps one RC connection per subscribed instance and fans events out to subscribed apps.
 * - `subscribed` is a full resync point (snapshot + history). After it, `event`s are deltas in order.
 *   Over the WebSocket, `seq` is increasing but not contiguous (the Host may coalesce text/thinking deltas).
 *   On reconnect, or when the Host loses its RC connection, the app gets `subscribed` again (or
 *   `subscribe_error` / `instance_gone`) and must rebuild that instance's view from it.
 * - Transcript items are deduplicated by `entryId` (live `message_end` items and `history` share ids).
 * - `spawn` starts a new Pi under abduco on the Host (M2). Its result only says the process started; the
 *   instance appears in `instances` once its RC has registered (the app waits for that instanceId).
 * - The Host forwards `rc` requests unchanged (incl. expectInstanceId / expectSessionId guards) and never
 *   retries them.
 */
import type {
	EventMessage,
	InstanceSnapshot,
	InstanceStatus,
	Origin,
	Request,
	Response,
	SessionRef,
	ThinkingLevel,
	TranscriptItem,
} from "./index.ts";
import type { SubagentCounts } from "./subagents.ts";

export const HOST_PROTOCOL_VERSION = 1;
export const DEFAULT_HOST_PORT = 47800;

/** Contents of the pairing QR code / deep link: `pimate://pair?h=<host:port>&c=<code>&n=<hostName>&id=<hostId>` */
export interface PairingLink {
	/** `host:port` reachable from the phone (Tailscale IP or MagicDNS name). IPv6 hosts are bracketed. */
	address: string;
	/** Single-use pairing code (base64url, >=128 bits), valid for a few minutes. */
	code: string;
	hostName: string;
	hostId: string;
}

export interface PairRequest {
	code: string;
	deviceName: string;
}

export interface PairResponse {
	hostId: string;
	hostName: string;
	deviceId: string;
	/** Long-lived bearer token (base64url, 256 bits). The Host stores only its hash. */
	token: string;
}

export interface PairError {
	error: "invalid_code" | "expired_code" | "bad_request";
}

/** Text-free, live-only alert. Never replayed from history or snapshots. */
export interface PiAlert {
	id: string;
	instanceId: string;
	sessionId: string;
	kind: "input" | "complete" | "failed" | "child_waiting" | "child_paused" | "child_failed";
}

export interface HostInfo {
	/** Optional capability: only send watch_alerts when true. */
	alerts?: boolean;
	/** Auth RPC timeout/long-poll support; RC providerAuth capability is also required. */
	providerAuth?: boolean;
	/** Optional capability: only send `dirs` (folder completion) when true; older Hosts close on unknown messages. */
	dirs?: boolean;
	hostId: string;
	name: string;
	protocol: number;
	version: string;
	platform: string;
}

/** One Pi instance as shown in the drawer. Derived from discovery meta (+ abduco attach state). */
export interface InstanceSummary {
	instanceId: string;
	cwd: string;
	origin: Origin;
	abducoSession: string | null;
	/** Whether a PC terminal is attached to the abduco session; null when not started under abduco. */
	pcAttached: boolean | null;
	session: SessionRef | null;
	status: InstanceStatus;
	startedAt: number;
	updatedAt: number;
	/** Subagent counts (M4); absent when the RC does not report them. */
	subagents?: SubagentCounts;
}

/** A folder offered on the "new Pi" screen (from Pi's saved sessions and running instances). */
export interface FolderInfo {
	/** Absolute path. */
	path: string;
	/** Last time a Pi session was used there (ms), if known. */
	lastUsed?: number;
	/** Number of running instances in this folder. */
	running: number;
	/** Saved project-trust decision (~/.pi/agent/trust.json), if any. */
	trusted?: boolean;
}

export interface SpawnParams {
	/** Absolute path or `~/...`; must be an existing directory. */
	cwd: string;
	/**
	 * Project-trust decision for this start only (handled by RC's `project_trust` handler so the TUI prompt
	 * never blocks a phone-started Pi). Omitted = decline.
	 */
	trust?: boolean;
	model?: { provider: string; id: string };
	thinking?: ThinkingLevel;
	/** PiMate's `pimate_ask` tool: true adds it (`--tools +pimate_ask`), false removes it, omitted = Pi settings. */
	askTool?: boolean;
	/** First prompt, sent once the Pi is ready. */
	message?: string;
}

export type SpawnErrorCode = "bad_request" | "not_found" | "not_directory" | "spawn_failed" | "unsupported";

// ---------------------------------------------------------------- app -> Host

export type AppMessage =
	| { type: "auth"; token: string; protocol: number; app: { version: string; platform: string } }
	| { type: "watch_alerts"; enabled: boolean }
	| { type: "subscribe"; instanceId: string }
	| { type: "unsubscribe"; instanceId: string }
	/** Forward an RC request to an instance. The reply is `rc_result` with the same `request.id`. */
	| { type: "rc"; instanceId: string; request: Request }
	| { type: "ping"; t: number }
	| { type: "folders"; requestId: string }
	/** Subfolder names of `path` (absolute or `~/...`) for completing the new Pi folder. */
	| { type: "dirs"; requestId: string; path: string }
	| { type: "spawn"; requestId: string; params: SpawnParams };

// ---------------------------------------------------------------- Host -> app

export type HostMessage =
	| { type: "alert"; alert: PiAlert }
	| { type: "auth_ok"; host: HostInfo; deviceId: string }
	| { type: "auth_error"; code: "invalid_token" | "protocol_mismatch" | "bad_request" }
	/** Full instance list; sent right after auth_ok and whenever it changes. */
	| { type: "instances"; instances: InstanceSummary[] }
	| {
			type: "subscribed";
			instanceId: string;
			snapshot: InstanceSnapshot;
			history: { session: SessionRef | null; items: TranscriptItem[] };
	  }
	| { type: "subscribe_error"; instanceId: string; code: "not_found" | "unreachable"; message?: string }
	| ({ type: "event" } & Omit<EventMessage, "type">)
	| { type: "rc_result"; instanceId: string; response: Response }
	/** The instance's process ended or its socket disappeared; subscriptions to it are dropped. */
	| { type: "instance_gone"; instanceId: string }
	| { type: "pong"; t: number }
	| { type: "folders_result"; requestId: string; home: string; folders: FolderInfo[] }
	/** Directory names only (no files), sorted; empty when the path is missing or unreadable. */
	| { type: "dirs_result"; requestId: string; dirs: string[] }
	| {
			type: "spawn_result";
			requestId: string;
			ok: true;
			instanceId: string;
			abducoSession: string;
			/** The Pi started but the first message could not be confirmed as sent. It is never resent. */
			messageError?: string;
	  }
	| { type: "spawn_result"; requestId: string; ok: false; code: SpawnErrorCode; message?: string };

/** WebSocket close codes used by the Host. */
export const HostCloseCode = {
	authFailed: 4401,
	authTimeout: 4408,
	protocol: 4400,
	revoked: 4403,
} as const;

// ---------------------------------------------------------------- pairing link helpers

// Hand-rolled query handling: URLSearchParams support differs between JS runtimes (Hermes / Node).
export function formatPairingLink(link: PairingLink): string {
	const q = [
		["h", link.address],
		["c", link.code],
		["n", link.hostName],
		["id", link.hostId],
	]
		.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
		.join("&");
	return `pimate://pair?${q}`;
}

function parseQuery(query: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const part of query.split("&")) {
		if (!part) continue;
		const i = part.indexOf("=");
		const key = i < 0 ? part : part.slice(0, i);
		const raw = i < 0 ? "" : part.slice(i + 1);
		try {
			out.set(decodeURIComponent(key), decodeURIComponent(raw.replace(/\+/g, " ")));
		} catch {
			// malformed escape: ignore this pair
		}
	}
	return out;
}

/** Parses a pairing link (pimate://pair?...); returns null when it is not a valid link. */
export function parsePairingLink(text: string): PairingLink | null {
	const trimmed = text.trim();
	const m = /^pimate:\/\/pair\?(.*)$/.exec(trimmed);
	if (!m) return null;
	const q = parseQuery(m[1]);
	const address = q.get("h");
	const code = q.get("c");
	const hostId = q.get("id");
	if (!address || !code || !hostId) return null;
	if (!/^[A-Za-z0-9_-]{16,}$/.test(code)) return null;
	if (!/^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):\d{1,5}$/.test(address)) return null;
	return { address, code, hostId, hostName: q.get("n") || address };
}
