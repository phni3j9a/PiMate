/**
 * Pairing with a Host: `POST http://<address>/pair` with the single-use code from the QR / deep link.
 * Errors are mapped to a small set the UI can explain. Pure TS: `fetch` is injected.
 */
import type { PairingLink, PairResponse } from "@pimate/protocol";

export { formatPairingLink, parsePairingLink } from "@pimate/protocol";

export type PairingFailureKind =
	| "invalid_code"
	| "expired_code"
	| "bad_request"
	| "unreachable"
	| "timeout"
	| "host_mismatch"
	| "unexpected";

export class PairingFailure extends Error {
	readonly kind: PairingFailureKind;
	constructor(kind: PairingFailureKind, message?: string) {
		super(message ?? kind);
		this.kind = kind;
	}
}

type FetchLike = (
	url: string,
	init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export async function pairWithHost(
	link: PairingLink,
	deviceName: string,
	fetchImpl: FetchLike,
	timeoutMs = 10_000,
): Promise<PairResponse> {
	const controller = typeof AbortController === "function" ? new AbortController() : undefined;
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller?.abort();
	}, timeoutMs);
	let guard: ReturnType<typeof setTimeout> | undefined;
	let res: { status: number; json(): Promise<unknown> };
	try {
		res = await Promise.race([
			fetchImpl(`http://${link.address}/pair`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code: link.code, deviceName: deviceName.trim().slice(0, 200) || "Phone" }),
				signal: controller?.signal,
			}),
			new Promise<never>((_, reject) => {
				// Some fetch implementations ignore AbortSignal; never hang the pairing screen.
				guard = setTimeout(() => reject(new PairingFailure("timeout")), timeoutMs + 50);
			}),
		]);
	} catch (error) {
		if (error instanceof PairingFailure) throw error;
		throw new PairingFailure(timedOut ? "timeout" : "unreachable", String(error));
	} finally {
		clearTimeout(timer);
		clearTimeout(guard);
	}
	let body: unknown = null;
	try {
		body = await res.json();
	} catch {
		// non-JSON body: handled below
	}
	if (res.status === 200) {
		const r = body as PairResponse | null;
		if (!r || typeof r.token !== "string" || typeof r.deviceId !== "string" || typeof r.hostId !== "string")
			throw new PairingFailure("unexpected", "Malformed pairing response");
		// The link names the host we meant to pair with; refuse a different one answering at that address.
		if (r.hostId !== link.hostId) throw new PairingFailure("host_mismatch");
		return { hostId: r.hostId, hostName: r.hostName || link.hostName, deviceId: r.deviceId, token: r.token };
	}
	const code = (body as { error?: string } | null)?.error;
	if (code === "invalid_code" || code === "expired_code" || code === "bad_request") throw new PairingFailure(code);
	if (res.status === 410) throw new PairingFailure("expired_code");
	if (res.status === 401) throw new PairingFailure("invalid_code");
	throw new PairingFailure("unexpected", `HTTP ${res.status}`);
}

/** User-facing explanation of a pairing failure. */
export function pairingErrorMessage(kind: PairingFailureKind, address: string): string {
	switch (kind) {
		case "invalid_code":
			return "コードが正しくないか、すでに使われています。PC で pimate pair をもう一度実行してください。";
		case "expired_code":
			return "コードの有効期限（10分）が切れています。PC で pimate pair をもう一度実行してください。";
		case "unreachable":
			return `${address} に接続できません。PC で pimate serve が動いているか、同じ Tailscale に接続しているか確認してください。`;
		case "timeout":
			return `${address} から応答がありません。ネットワークを確認してください。`;
		case "host_mismatch":
			return "QR コードと違うマシンが応答したため、ペアリングを中止しました。";
		case "bad_request":
			return "ペアリングの要求が受け付けられませんでした。アプリと PiMate を最新にしてください。";
		default:
			return "ペアリングに失敗しました。もう一度お試しください。";
	}
}
