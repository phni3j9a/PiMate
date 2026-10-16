import type { HostInfo, HostMessage } from "@pimate/protocol";
import type { SocketLike } from "../src/lib/hostConnection";

export class FakeSocket implements SocketLike {
	static all: FakeSocket[] = [];
	readyState = 0;
	sent: any[] = [];
	closedWith: number | undefined;
	onopen: ((ev: unknown) => void) | null = null;
	onmessage: ((ev: { data: unknown }) => void) | null = null;
	onclose: ((ev: { code?: number }) => void) | null = null;
	onerror: ((ev: unknown) => void) | null = null;
	readonly url: string;

	constructor(url: string) {
		this.url = url;
		FakeSocket.all.push(this);
	}
	static last(): FakeSocket {
		return FakeSocket.all[FakeSocket.all.length - 1];
	}
	static reset() {
		FakeSocket.all = [];
	}
	send(data: string) {
		if (this.readyState !== 1) throw new Error("not open");
		this.sent.push(JSON.parse(data));
	}
	close(code?: number) {
		if (this.readyState === 3) return;
		this.closedWith = code;
		this.readyState = 3;
		this.onclose?.({ code: code ?? 1000 });
	}
	open() {
		this.readyState = 1;
		this.onopen?.({});
	}
	receive(msg: HostMessage | Record<string, unknown>) {
		this.onmessage?.({ data: JSON.stringify(msg) });
	}
	/** The server (or network) closed the socket. */
	drop(code = 1006) {
		this.readyState = 3;
		this.onclose?.({ code });
	}
	sentOfType(type: string) {
		return this.sent.filter((m) => m.type === type);
	}
}

export const hostInfo = { hostId: "h1", name: "server-Macmini", protocol: 1, version: "0.0.0", platform: "linux" };

/** Opens the socket and completes auth. */
export function authenticate(socket: FakeSocket, instances: unknown[] = [], capabilities: Partial<HostInfo> = {}) {
	socket.open();
	socket.receive({ type: "auth_ok", host: { ...hostInfo, ...capabilities }, deviceId: "d1" });
	socket.receive({ type: "instances", instances });
}
