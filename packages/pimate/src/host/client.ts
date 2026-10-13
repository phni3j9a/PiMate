import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import { createConnection } from "node:net";
import { join } from "node:path";
import type {
	EventMessage,
	InstanceSnapshot,
	ParamsOf,
	RcMethod,
	Request,
	ResultOf,
	ServerMessage,
} from "@pimate/protocol";
import { encodeLine, LineDecoder } from "@pimate/protocol";
import { RcError } from "../extension/dispatch.ts";
import { privateRunDir, validInstanceId } from "../runtime.ts";

export class RcClient {
	readonly runDir: string;
	readonly instanceId: string;
	readonly timeoutMs: number;
	snapshot?: InstanceSnapshot;
	private socket?: Socket;
	private pending = new Map<
		string,
		{ resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
	>();
	private listeners = new Set<(event: EventMessage) => void>();
	constructor(runDir: string, instanceId: string, timeoutMs = 5000) {
		if (!validInstanceId(instanceId)) throw new RcError("bad_request", "Invalid instance id");
		this.runDir = runDir;
		this.instanceId = instanceId;
		this.timeoutMs = timeoutMs;
	}
	async connect(): Promise<InstanceSnapshot> {
		if (this.socket) throw new Error("Client already connected");
		privateRunDir(this.runDir);
		const sock = createConnection(join(this.runDir, `${this.instanceId}.sock`));
		this.socket = sock;
		sock.setEncoding("utf8");
		const decoder = new LineDecoder(
			(value) => this.receive(value),
			() => sock.destroy(new Error("Invalid RC JSON")),
		);
		sock.on("data", (chunk) => decoder.push(String(chunk)));
		sock.on("error", (e) => {
			if (this.socket === sock) this.fail(e);
		});
		sock.on("close", () => {
			if (this.socket !== sock) return;
			this.socket = undefined;
			this.fail(new Error("RC connection closed"));
		});
		try {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					sock.destroy();
					reject(new RcError("timeout", "RC connect timed out"));
				}, this.timeoutMs);
				const finish = (error?: Error) => {
					clearTimeout(timer);
					sock.off("connect", onConnect);
					sock.off("error", onError);
					error ? reject(error) : resolve();
				};
				const onConnect = () => finish();
				const onError = (e: Error) => finish(e);
				sock.once("connect", onConnect);
				sock.once("error", onError);
			});
			const { snapshot } = await this.request("hello", {});
			if (snapshot.instanceId !== this.instanceId || snapshot.protocol !== 1)
				throw new RcError("unsupported", "Unexpected RC identity or protocol");
			this.snapshot = snapshot;
			return snapshot;
		} catch (e) {
			this.close();
			throw e;
		}
	}
	request<M extends RcMethod>(
		method: M,
		params: ParamsOf<M>,
		guards: Pick<Request, "expectInstanceId" | "expectSessionId"> = {},
		timeoutMs?: number,
	): Promise<ResultOf<M>> {
		// subagents_rpc waits on the RC side for params.timeoutMs; allow for that plus a margin.
		const rpcTimeout = method === "subagents_rpc" ? (params as { timeoutMs?: number }).timeoutMs : undefined;
		const wait =
			timeoutMs ??
			(method === "subagents_rpc" ? Math.max(this.timeoutMs, (rpcTimeout ?? 15000) + 2000) : this.timeoutMs);
		if (!this.socket || this.socket.destroyed) return Promise.reject(new Error("RC not connected"));
		const id = randomUUID();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new RcError("timeout", `RC ${method} timed out`));
			}, wait);
			this.pending.set(id, { resolve, reject, timer });
			this.socket!.write(encodeLine({ id, method, params, expectInstanceId: this.instanceId, ...guards }));
		});
	}
	onEvent(listener: (event: EventMessage) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	close(): void {
		const sock = this.socket;
		this.socket = undefined;
		sock?.destroy();
		this.fail(new Error("RC client closed"));
	}
	private fail(error: Error): void {
		for (const p of this.pending.values()) {
			clearTimeout(p.timer);
			p.reject(error);
		}
		this.pending.clear();
	}
	private receive(value: unknown): void {
		if (!value || typeof value !== "object") return;
		const msg = value as ServerMessage;
		if (msg.type === "event") {
			if (msg.instanceId === this.instanceId) for (const listener of this.listeners) listener(msg);
			return;
		}
		if (msg.type !== "response" || !msg.id) return;
		const p = this.pending.get(msg.id);
		if (!p) return;
		this.pending.delete(msg.id);
		clearTimeout(p.timer);
		if (msg.ok) p.resolve(msg.result);
		else p.reject(new RcError(msg.error.code, msg.error.message, msg.error.data));
	}
}
