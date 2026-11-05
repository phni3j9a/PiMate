import { setTimeout as delay } from "node:timers/promises";
import type { HostCore } from "./index.ts";
import { hostHome } from "./operations.ts";

/** Only these RC methods reach the login Pi from apps. */
export const AUTH_SESSION_METHODS: ReadonlySet<string> = new Set([
	"hello",
	"auth_list",
	"auth_begin",
	"auth_wait",
	"auth_respond",
	"auth_cancel",
	"auth_logout",
]);
/** A bare, ephemeral Pi: no session file, user extensions, skills, context, tools or project-local files. */
export const LOGIN_PI_ARGS = [
	"--no-session",
	"--no-extensions",
	"--no-skills",
	"--no-context-files",
	"--no-prompt-templates",
	"--no-themes",
	"--no-tools",
	"--no-mcp",
	"--no-approve",
];

type Core = Pick<HostCore, "spawn" | "client" | "env">;
function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * One Host-owned login Pi (Issue #105). Holders (app connections) keep it alive; it is shut down `graceMs`
 * after the last one leaves, but never while a credential is being saved. Login Pis this Host does not own
 * (e.g. left by a previous Host process) are shut down on discovery.
 */
export class AuthSession {
	private id?: string;
	/** The current login Pi's process, from its RC: discovery may lag behind it, the process does not. */
	private pid?: number;
	private holders = new Set<object>();
	private starting?: Promise<string>;
	private stopping?: Promise<void>;
	private stopTimer?: NodeJS.Timeout;
	private orphans = new Set<string>();
	private closed = false;
	private readonly core: Core;
	private readonly options: { graceMs?: number; readyMs?: number; retryMs?: number };
	constructor(core: Core, options: { graceMs?: number; readyMs?: number; retryMs?: number } = {}) {
		this.core = core;
		this.options = options;
	}

	/** The current login Pi, the only hidden instance apps may reach. */
	owns(id: string): boolean {
		return !!this.id && id === this.id;
	}

	/** Starts or reuses the login Pi once its RC answers. */
	async acquire(holder: object): Promise<string> {
		if (this.closed) throw new Error("Host is stopping");
		this.holders.add(holder);
		clearTimeout(this.stopTimer);
		this.stopTimer = undefined;
		try {
			// A shutdown that already began finishes first; it may keep a Pi that is saving.
			await this.stopping;
			if (this.id && (await this.probe(this.id))) return this.id;
			if (this.closed) throw new Error("Host is stopping");
			this.starting ??= this.start().finally(() => {
				this.starting = undefined;
			});
			return await this.starting;
		} catch (error) {
			this.release(holder);
			throw error;
		}
	}

	release(holder: object): void {
		if (this.holders.delete(holder) && !this.holders.size && !this.closed) this.schedule(this.options.graceMs ?? 60000);
	}

	/** Discovery results: forget an exited login Pi, shut down ones this Host does not own. */
	observe(instances: { instanceId: string; purpose?: "auth" }[]): void {
		if (this.starting || this.stopping || this.closed) return;
		if (this.id && this.pid && !alive(this.pid)) this.id = this.pid = undefined;
		for (const { instanceId, purpose } of instances)
			if (purpose === "auth" && instanceId !== this.id && !this.orphans.has(instanceId)) {
				this.orphans.add(instanceId);
				void this.shutdown(instanceId).finally(() => this.orphans.delete(instanceId));
			}
	}

	async close(): Promise<void> {
		this.closed = true;
		clearTimeout(this.stopTimer);
		// A Pi still starting is shut down too once its RC answers (bounded by readyMs).
		await this.starting?.catch(() => {});
		await this.stopping;
		if (this.id) await this.shutdown(this.id);
	}

	private schedule(ms: number): void {
		clearTimeout(this.stopTimer);
		this.stopTimer = setTimeout(() => this.stop(), ms).unref();
	}

	private stop(): void {
		this.stopTimer = undefined;
		const id = this.id;
		if (!id || this.holders.size || this.stopping) return;
		if (this.starting) {
			this.schedule(this.options.retryMs ?? 5000);
			return;
		}
		this.stopping = (async () => {
			if (await this.shutdown(id)) {
				if (this.id === id) this.id = undefined;
			} else if (!this.holders.size) this.schedule(this.options.retryMs ?? 5000);
		})().finally(() => {
			this.stopping = undefined;
		});
	}

	private async start(): Promise<string> {
		const { instanceId } = await this.core.spawn({
			cwd: hostHome(this.core.env),
			args: LOGIN_PI_ARGS,
			purpose: "auth",
		});
		this.id = instanceId;
		this.pid = undefined;
		const end = Date.now() + (this.options.readyMs ?? 30000);
		while (!(await this.probe(instanceId))) {
			if (Date.now() >= end) {
				// shortcut: a login Pi stuck before its RC registers is left to exit by itself or be reaped on discovery.
				if (this.id === instanceId) this.id = undefined;
				throw new Error("Login Pi did not become ready");
			}
			await delay(250);
		}
		return instanceId;
	}

	/** Whether its RC answers; remembers the pid of the current login Pi. */
	private async probe(id: string): Promise<boolean> {
		const client = this.core.client(id);
		try {
			const { pid } = await client.connect();
			if (id === this.id) this.pid = pid;
			return true;
		} catch {
			return false;
		} finally {
			client.close();
		}
	}

	/** false = deferred because a credential is being saved. Unreachable counts as done. */
	private async shutdown(id: string): Promise<boolean> {
		const client = this.core.client(id);
		try {
			await client.connect();
			const { flow } = await client.request("auth_list", {});
			if (flow?.status === "saving") return false;
			// Cancel first so the flow cannot start saving before the shutdown lands; busy = saving began.
			if (flow && (flow.status === "working" || flow.status === "input"))
				try {
					await client.request("auth_cancel", { flowId: flow.id });
				} catch (e) {
					if ((e as { code?: string }).code === "busy") return false; // other errors: the flow already ended
				}
			await client.request("shutdown", {});
		} catch {
			/* already gone, or no longer reachable */
		} finally {
			client.close();
		}
		return true;
	}
}
