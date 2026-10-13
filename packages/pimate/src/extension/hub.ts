import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
	SessionRef,
} from "@pimate/protocol";
import { encodeLine, LineDecoder, PROTOCOL_VERSION } from "@pimate/protocol";
import { privateRunDir, resolveRunDir, validInstanceId } from "../runtime.ts";
import type { Handlers } from "./dispatch.ts";
import { dispatch } from "./dispatch.ts";
import type { PendingUI } from "./ui.ts";

export class Hub {
	instanceId: string;
	origin: Origin;
	abducoSession: string | null;
	startedAt = Date.now();
	seq = 0;
	status: InstanceStatus = "idle";
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
	subscriptions: (() => void)[] = [];
	tui?: { requestRender(force?: boolean): void };
	winchInstalled = false;
	constructor() {
		this.instanceId = process.env.PIMATE_INSTANCE_ID || randomUUID();
		this.origin = process.env.PIMATE_ORIGIN === "mobile" ? "mobile" : "pc";
		this.abducoSession = process.env.PIMATE_ABDUCO_SESSION ?? null;
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
	setStatus = (status: InstanceStatus): void => {
		if (this.status === status) return;
		this.status = status;
		this.writeMeta();
		this.emit({ type: "status", status });
	};
	snapshot(): InstanceSnapshot {
		return {
			protocol: PROTOCOL_VERSION,
			instanceId: this.instanceId,
			pid: process.pid,
			cwd: this.ctx?.cwd ?? process.cwd(),
			origin: this.origin,
			abducoSession: this.abducoSession,
			startedAt: this.startedAt,
			session: this.session,
			status: this.status,
			model: this.ctx?.model ? { provider: this.ctx.model.provider, id: this.ctx.model.id } : null,
			thinking: this.pi?.getThinkingLevel() ?? null,
			pendingUI: [...this.pendingUI.values()].map((p) => p.request),
			seq: this.seq,
		};
	}
	writeMeta(): void {
		if (!this.server) return;
		const { model: _, thinking: __, pendingUI: ___, seq: ____, ...snapshot } = this.snapshot();
		const meta: InstanceMeta = { ...snapshot, updatedAt: Date.now() };
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
		process.once("exit", () => this.cleanup());
	}
	cleanup(): void {
		rmSync(this.sockPath, { force: true });
		rmSync(this.metaPath, { force: true });
	}
	stop(): void {
		for (const p of this.pendingUI.values()) p.cancel();
		for (const c of this.clients) c.destroy();
		this.clients.clear();
		this.server?.close();
		this.server = undefined;
		this.cleanup();
	}
}
const global = globalThis as typeof globalThis & { __pimateV1Hub?: Hub };
export function getHub(): Hub {
	global.__pimateV1Hub ??= new Hub();
	return global.__pimateV1Hub;
}
