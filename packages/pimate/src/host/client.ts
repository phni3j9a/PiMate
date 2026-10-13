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
	Response,
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
		{ resolve: (value: Response) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
	>();
	private closeListeners = new Set<() => void>();
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
			for (const listener of this.closeListeners) listener();
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
					sock.off("close", onClose);
					error ? reject(error) : resolve();
				};
				const onConnect = () => finish();
				const onError = (e: Error) => finish(e);
				const onClose = () => finish(new Error("RC connection closed"));
				sock.once("connect", onConnect);
				sock.once("error", onError);
				sock.once("close", onClose);
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
		return this.send({ id: randomUUID(), method, params, ...guards }, timeoutMs).then((response) => {
			if (!response.ok) throw new RcError(response.error.code, response.error.message, response.error.data);
			return response.result as ResultOf<M>;
		});
	}
	send(request: Request, timeoutMs?: number): Promise<Response> {
		const rpcTimeout =
			request.method === "subagents_rpc" ? (request.params as { timeoutMs?: number })?.timeoutMs : undefined;
		const wait =
			timeoutMs ??
			(request.method === "subagents_rpc" ? Math.max(this.timeoutMs, (rpcTimeout ?? 15000) + 2000) : this.timeoutMs);
		if (!this.socket || this.socket.destroyed) return Promise.reject(new Error("RC not connected"));
		if (this.pending.has(request.id))
			return Promise.resolve({
				type: "response",
				id: request.id,
				ok: false,
				error: { code: "bad_request", message: "RC request id already in flight" },
			});
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(request.id);
				reject(new RcError("timeout", `RC ${request.method} timed out`));
			}, wait);
			this.pending.set(request.id, { resolve, reject, timer });
			this.socket!.write(encodeLine({ ...request, expectInstanceId: request.expectInstanceId ?? this.instanceId }));
		});
	}
	onClose(listener: () => void): () => void {
		this.closeListeners.add(listener);
		return () => this.closeListeners.delete(listener);
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
		p.resolve(msg);
	}
}
