import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, type FSWatcher, renameSync, rmSync, watch, writeFileSync } from "node:fs";
import type { Server, Socket } from "node:net";
import { createServer } from "node:net";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	InstanceEvent,
	InstanceMeta,
	InstanceSnapshot,
	InstanceStatus,
	Origin,
	PcPrompt,
	QuotaSource,
	SessionRef,
	SubscriptionQuota,
} from "@pimate/protocol";
import { countSubagents, encodeLine, LineDecoder, MAX_PROMPT_IMAGES, PROTOCOL_VERSION } from "@pimate/protocol";
import { PACKAGE_VERSION } from "../package.ts";
import { privateRunDir, resolveRunDir, validInstanceId } from "../runtime.ts";
import type { ProviderAuth } from "./auth.ts";
import type { Handlers } from "./dispatch.ts";
import { dispatch } from "./dispatch.ts";
import { isQuotaFile, readSharedQuotas, writeSharedQuota } from "./quota.ts";
import type { SubagentRegistry } from "./subagents/registry.ts";
import type { PendingUI } from "./ui.ts";

export class Hub {
	instanceId: string;
	origin: Origin;
	abducoSession: string | null;
	startedAt = Date.now();
	seq = 0;
	streaming = { text: "", thinking: "" };
	status: InstanceStatus = "idle";
	agentActive = false;
	treeNavigating = false;
	dir: string;
	sockPath: string;
	metaPath: string;
	pi?: ExtensionAPI;
	ctx?: ExtensionContext;
	session: SessionRef | null = null;
	server?: Server;
	clients = new Set<Socket>();
	pendingUI = new Map<string, PendingUI>();
	handlers?: Handlers;
	auth?: ProviderAuth;
	subagents?: SubagentRegistry;
	subscriptions: (() => void)[] = [];
	tui?: { requestRender(force?: boolean): void };
	winchInstalled = false;
	pcPrompt: PcPrompt | null = null;
	/** Account-wide, so it survives session switches and reloads for the life of the process. */
	quotas = new Map<QuotaSource, SubscriptionQuota>();
	quotaWatcher?: FSWatcher;
	trust?: "yes" | "no";
	constructor() {
		this.instanceId = process.env.PIMATE_INSTANCE_ID || randomUUID();
		this.origin = process.env.PIMATE_ORIGIN === "mobile" ? "mobile" : "pc";
		this.abducoSession = process.env.PIMATE_ABDUCO_SESSION ?? null;
		if (this.origin === "mobile" && ["yes", "no"].includes(process.env.PIMATE_TRUST ?? ""))
			this.trust = process.env.PIMATE_TRUST as "yes" | "no";
		delete process.env.PIMATE_TRUST;
		delete process.env.PIMATE_INSTANCE_ID;
		delete process.env.PIMATE_ORIGIN;
		delete process.env.PIMATE_ABDUCO_SESSION;
		if (!validInstanceId(this.instanceId)) throw new Error("Invalid PIMATE_INSTANCE_ID");
		this.dir = resolveRunDir();
		this.sockPath = join(this.dir, `${this.instanceId}.sock`);
		this.metaPath = join(this.dir, `${this.instanceId}.json`);
	}
	isIdle = () => this.ctx?.isIdle() ?? true;
	emit = (event: InstanceEvent): void => {
		// The server only runs in UI sessions; don't read ctx here, it may be stale during session switches.
		if (!this.server) return;
		if (event.type === "text_delta") this.streaming.text += event.delta;
		else if (event.type === "thinking_delta") this.streaming.thinking += event.delta;
		else if (event.type === "message_end" || event.type === "agent_settled" || event.type === "session_changed")
			this.streaming = { text: "", thinking: "" };
		const line = encodeLine({
			type: "event",
			instanceId: this.instanceId,
			sessionId: this.session?.id ?? null,
			seq: ++this.seq,
			event,
		});
		for (const c of this.clients) {
			// A disconnected/slow reader must not grow Pi's memory without bound.
			if (c.writableLength > 8 * 1024 * 1024) c.destroy();
			else c.write(line);
		}
	};
	emitContext = (): void => {
		this.emit({ type: "context", context: this.ctx?.getContextUsage() ?? null });
	};
	/** A quota observed by this process: show it and share it with the other Pi processes on this PC. */
	setQuota = (quota: SubscriptionQuota): void => {
		this.quotas.set(quota.source, quota);
		this.emit({ type: "quota", quota });
		try {
			writeSharedQuota(this.dir, quota);
		} catch {}
	};
	/** Adopts snapshots another Pi process (or a subagent runner) observed later than ours. */
	loadSharedQuotas = (): void => {
		for (const quota of readSharedQuotas(this.dir)) {
			if ((this.quotas.get(quota.source)?.observedAt ?? -1) >= quota.observedAt) continue;
			this.quotas.set(quota.source, quota);
			this.emit({ type: "quota", quota });
		}
	};
	setStatus = (status: InstanceStatus): void => {
		if (this.status === status) return;
		this.status = status;
		this.writeMeta();
		this.emit({ type: "status", status });
	};
	snapshot(): InstanceSnapshot {
		return {
			protocol: PROTOCOL_VERSION,
			version: PACKAGE_VERSION,
			instanceId: this.instanceId,
			pid: process.pid,
			cwd: this.ctx?.cwd ?? process.cwd(),
			origin: this.origin,
			abducoSession: this.abducoSession,
			startedAt: this.startedAt,
			session: this.session,
			status: this.status,
			agentActive: this.agentActive,
			promptImages: true,
			promptImageLimit: MAX_PROMPT_IMAGES,
			entryImages: true,
			fileImages: true,
			sessionTree: true,
			slashCommands: true,
			providerAuth: true,
			model: this.ctx?.model ? { provider: this.ctx.model.provider, id: this.ctx.model.id } : null,
			thinking: this.pi?.getThinkingLevel() ?? null,
			pendingUI: [...this.pendingUI.values()].map((p) => p.request),
			pcPrompt: this.pcPrompt,
			context: this.ctx?.getContextUsage() ?? null,
			seq: this.seq,
			streaming: { ...this.streaming },
			subagents: this.subagents?.snapshot(),
			quotas: [...this.quotas.values()],
		};
	}
	writeMeta(): void {
		if (!this.server) return;
		const {
			model: _,
			thinking: __,
			pendingUI: ___,
			seq: ____,
			streaming: _____,
			context: ______,
			pcPrompt: _______,
			agentActive: ________,
			quotas: _________,
			subagents,
			...snapshot
		} = this.snapshot();
		const meta: InstanceMeta = {
			...snapshot,
			updatedAt: Date.now(),
			subagents: subagents ? countSubagents(subagents.runs) : undefined,
		};
		const tmp = `${this.metaPath}.${randomUUID()}.tmp`;
		// Best effort: a removed run dir or full disk must not break dialogs or status updates.
		try {
			writeFileSync(tmp, JSON.stringify(meta), { mode: 0o600, flag: "wx" });
			renameSync(tmp, this.metaPath);
		} catch {
			// Not logged: writing to stderr would corrupt the TUI. The Host then sees stale or missing meta.
		} finally {
			rmSync(tmp, { force: true });
		}
	}
	async start(): Promise<void> {
		if (this.server) return;
		privateRunDir(this.dir);
		// Never unlink a live instance's socket (including accidental duplicate IDs).
		if (existsSync(this.sockPath)) throw new Error(`Instance socket already exists: ${this.sockPath}`);
		const server = createServer((sock) => {
			this.clients.add(sock);
			sock.setEncoding("utf8");
			const decoder = new LineDecoder(
				(value) => {
					if (!this.handlers) return;
					void dispatch(value, { instanceId: this.instanceId, sessionId: this.session?.id }, this.handlers).then(
						(reply) => {
							if (!sock.destroyed) sock.write(encodeLine(reply));
						},
					);
				},
				() =>
					sock.write(
						encodeLine({
							type: "response",
							id: null,
							ok: false,
							error: { code: "bad_request", message: "Invalid JSON" },
						}),
					),
			);
			sock.on("data", (chunk) => decoder.push(String(chunk)));
			sock.on("close", () => this.clients.delete(sock));
			sock.on("error", () => sock.destroy());
		});
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(this.sockPath, () => {
				server.off("error", reject);
				chmodSync(this.sockPath, 0o600);
				resolve();
			});
		});
		server.on("error", (e) => this.ctx?.ui.notify(`PiMate socket: ${e.message}`, "error"));
		server.unref();
		this.server = server;
		// Watch before the first read so a write in between is not lost (observedAt dedups the overlap).
		try {
			this.quotaWatcher = watch(this.dir, (_, name) => isQuotaFile(name) && this.loadSharedQuotas());
			this.quotaWatcher.on("error", () => {});
			this.quotaWatcher.unref();
		} catch {}
		this.loadSharedQuotas();
		process.once("exit", () => this.cleanup());
	}
	cleanup(): void {
		rmSync(this.sockPath, { force: true });
		rmSync(this.metaPath, { force: true });
	}
	stop(): void {
		this.auth?.dispose();
		this.subagents?.dispose();
		for (const p of this.pendingUI.values()) p.cancel();
		for (const c of this.clients) c.destroy();
		this.clients.clear();
		this.server?.close();
		this.server = undefined;
		this.quotaWatcher?.close();
		this.quotaWatcher = undefined;
		this.cleanup();
	}
}
const global = globalThis as typeof globalThis & { __pimateV1Hub?: Hub };
export function getHub(): Hub {
	global.__pimateV1Hub ??= new Hub();
	return global.__pimateV1Hub;
}
