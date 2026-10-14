/**
 * App state: paired hosts and their connections, the selected instance's view, drafts and sends.
 * A tiny external store (read with useSyncExternalStore). Platform services are injected, so this stays testable.
 *
 * Sending rules (docs/SPEC.md §3): a prompt carries expectInstanceId / expectSessionId, is never inserted
 * optimistically and never re-sent. The draft stays until the Host confirms delivery.
 */
import type { InstanceSummary, PairingLink, PairResponse, Request, Response } from "@pimate/protocol";
import { type AuthFailure, type ConnectionState, HostConnection, RcError, type SocketLike } from "./hostConnection";
import { HostRegistry, type KeyValueStorage, type PairedHost, type Selection } from "./hostRegistry";
import { createView, findDeliveredUserItem, type InstanceView, reduceView, userEntryIds } from "./instanceView";
import { pairWithHost } from "./pairing";

export interface HostRuntime {
	hostId: string;
	hostName: string;
	address: string;
	pairedAt: number;
	state: ConnectionState;
	authFailure: AuthFailure | null;
	platform: string | null;
	instances: InstanceSummary[];
	nextRetryAt: number | null;
}

export type OutboxState = "sending" | "delivered" | "queued" | "unconfirmed";

export interface OutboxEntry {
	id: string;
	text: string;
	state: OutboxState;
	deliveredAs?: "prompt" | "steer" | "followUp";
	/** User entryIds present when the message was sent. */
	known: string[];
	sentAt: number;
}

export interface ChatNotice {
	kind: "error" | "unconfirmed";
	title?: string;
	text: string;
}

export interface AppState {
	loaded: boolean;
	hosts: HostRuntime[];
	selection: Selection | null;
	view: InstanceView | null;
	drafts: Record<string, string>;
	/** Sends of the selected instance that are not (yet) visible in the transcript. */
	outbox: OutboxEntry[];
	notice: ChatNotice | null;
	/** The conversation behind the draft changed; sending needs an explicit confirmation. */
	targetChanged: { to?: string } | null;
	aborting: boolean;
}

type FetchLike = Parameters<typeof pairWithHost>[2];

export interface StoreDeps {
	storage: KeyValueStorage;
	createSocket(url: string): SocketLike;
	fetch: FetchLike;
	randomUUID(): string;
	deviceName(): string;
	app: { version: string; platform: string };
	now?: () => number;
}

export const draftKey = (s: Selection) => `${s.hostId}/${s.instanceId}`;

/** The draft still holds the text that was sent (trailing whitespace is not sent). */
const sameText = (draft: string | undefined, sent: string) => (draft ?? "").replace(/\s+$/, "") === sent;

const UNCONFIRMED_AFTER_SYNC =
	"届いたか確認できませんでした。履歴を確かめてから、必要なら送り直してください（自動で再送しません）";

function rcErrorText(code: string, message?: string): ChatNotice {
	switch (code) {
		case "session_changed":
			return {
				kind: "error",
				title: "送信しませんでした",
				text: "PC で会話が切り替わりました。宛先を確認してから送信してください。",
			};
		case "instance_mismatch":
			return { kind: "error", title: "送信しませんでした", text: "別の Pi に切り替わっていました。" };
		case "not_found":
			return { kind: "error", title: "送信しませんでした", text: "この Pi は終了しています。" };
		case "offline":
			return {
				kind: "error",
				title: "送信していません",
				text: "PC に接続していません。再接続してから送信してください。",
			};
		case "busy":
		case "not_ready":
			return {
				kind: "error",
				title: "送信しませんでした",
				text: "Pi が受け付けられない状態でした。少し待ってからお試しください。",
			};
		default:
			return { kind: "error", title: "送信できませんでした", text: message ? `${code}: ${message}` : code };
	}
}

export class AppStore {
	private state: AppState = {
		loaded: false,
		hosts: [],
		selection: null,
		view: null,
		drafts: {},
		outbox: [],
		notice: null,
		targetChanged: null,
		aborting: false,
	};
	private readonly listeners = new Set<() => void>();
	private readonly deps: StoreDeps;
	private readonly registry: HostRegistry;
	private readonly records = new Map<string, PairedHost>();
	private readonly connections = new Map<string, HostConnection>();
	private readonly unsubscribers = new Map<string, () => void>();
	private initPromise: Promise<void> | null = null;

	constructor(deps: StoreDeps) {
		this.deps = deps;
		this.registry = new HostRegistry(deps.storage);
	}

	// ------------------------------------------------------------ external store

	getState = (): AppState => this.state;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	private set(patch: Partial<AppState>): void {
		this.state = { ...this.state, ...patch };
		for (const l of this.listeners) l();
	}

	private now(): number {
		return this.deps.now?.() ?? Date.now();
	}

	connection(hostId: string): HostConnection | undefined {
		return this.connections.get(hostId);
	}

	// ------------------------------------------------------------ lifecycle

	init(): Promise<void> {
		this.initPromise ??= (async () => {
			let hosts: PairedHost[] = [];
			let selection: Selection | null = null;
			try {
				hosts = await this.registry.load();
				selection = await this.registry.loadSelection();
			} catch {
				// Unreadable storage: start unpaired rather than crash.
			}
			for (const host of hosts) this.attach(host);
			this.set({ loaded: true, hosts: this.runtimes() });
			if (selection && this.records.has(selection.hostId)) this.select(selection.hostId, selection.instanceId);
		})();
		return this.initPromise;
	}

	/** App came back to the foreground. */
	foreground(): void {
		for (const c of this.connections.values()) c.foreground();
	}

	retryConnection(hostId: string): void {
		this.connections.get(hostId)?.retryNow();
	}

	dispose(): void {
		for (const c of this.connections.values()) c.stop();
		for (const off of this.unsubscribers.values()) off();
		this.connections.clear();
		this.unsubscribers.clear();
	}

	// ------------------------------------------------------------ hosts

	private runtime(record: PairedHost): HostRuntime {
		const c = this.connections.get(record.hostId);
		return {
			hostId: record.hostId,
			hostName: c?.info?.name || record.hostName,
			address: record.address,
			pairedAt: record.pairedAt,
			state: record.needsRepair ? "auth_failed" : (c?.state ?? "idle"),
			authFailure: c?.authFailure ?? (record.needsRepair ? "invalid_token" : null),
			platform: c?.info?.platform ?? null,
			instances: c?.instances ?? [],
			nextRetryAt: c?.nextRetryAt ?? null,
		};
	}

	private runtimes(): HostRuntime[] {
		return [...this.records.values()].map((r) => this.runtime(r));
	}

	private attach(record: PairedHost): void {
		this.detach(record.hostId);
		this.records.set(record.hostId, record);
		const conn = new HostConnection(record.address, record.token, {
			createSocket: this.deps.createSocket,
			app: this.deps.app,
			now: this.deps.now,
		});
		this.connections.set(record.hostId, conn);
		const offChange = conn.onChange(() => this.onConnectionChange(record.hostId));
		const offMessage = conn.onMessage((msg) => this.onHostMessage(record.hostId, msg));
		this.unsubscribers.set(record.hostId, () => {
			offChange();
			offMessage();
		});
		if (!record.needsRepair) conn.start();
	}

	private detach(hostId: string): void {
		this.connections.get(hostId)?.stop();
		this.connections.delete(hostId);
		this.unsubscribers.get(hostId)?.();
		this.unsubscribers.delete(hostId);
		this.records.delete(hostId);
	}

	async pair(link: PairingLink): Promise<PairResponse> {
		const res = await pairWithHost(link, this.deps.deviceName(), this.deps.fetch);
		await this.addPairedHost(res, link.address);
		return res;
	}

	async addPairedHost(res: PairResponse, address: string): Promise<void> {
		const record: PairedHost = {
			hostId: res.hostId,
			hostName: res.hostName,
			address,
			deviceId: res.deviceId,
			token: res.token,
			pairedAt: this.now(),
		};
		await this.registry.save(record);
		this.attach(record);
		const sel = this.state.selection;
		// Re-pairing the host behind the open chat: subscribe again on the new connection.
		if (sel?.hostId === record.hostId) this.connections.get(record.hostId)?.setSubscription(sel.instanceId);
		this.set({ hosts: this.runtimes() });
	}

	async removeHost(hostId: string): Promise<void> {
		await this.registry.remove(hostId);
		this.detach(hostId);
		const patch: Partial<AppState> = { hosts: this.runtimes() };
		if (this.state.selection?.hostId === hostId) {
			Object.assign(patch, { selection: null, view: null, outbox: [], notice: null, targetChanged: null });
			void this.registry.saveSelection(null).catch(() => {});
		}
		this.set(patch);
		this.autoSelect();
	}

	private onConnectionChange(hostId: string): void {
		const record = this.records.get(hostId);
		const conn = this.connections.get(hostId);
		if (!record || !conn) return;
		if (conn.state === "auth_failed" && !record.needsRepair) {
			record.needsRepair = true;
			void this.registry.save(record).catch(() => {});
		}
		this.set({ hosts: this.runtimes() });
		this.dropVanishedSelection(hostId);
		this.autoSelect();
	}

	/** A restored selection whose instance no longer exists (never seen alive this session) is cleared. */
	private dropVanishedSelection(hostId: string): void {
		const { selection, view } = this.state;
		const conn = this.connections.get(hostId);
		if (!selection || selection.hostId !== hostId || conn?.state !== "connected") return;
		if (conn.instances.some((i) => i.instanceId === selection.instanceId)) return;
		if (view && (view.phase === "loading" || view.phase === "error") && view.items.length === 0) {
			conn.setSubscription(null);
			this.set({ selection: null, view: null, outbox: [], notice: null, targetChanged: null });
			void this.registry.saveSelection(null).catch(() => {});
		}
	}

	/** Nothing selected yet: open the most recently active instance. */
	private autoSelect(): void {
		if (!this.state.loaded || this.state.selection) return;
		let best: { hostId: string; instance: InstanceSummary } | null = null;
		for (const [hostId, conn] of this.connections) {
			if (conn.state !== "connected") continue;
			for (const instance of conn.instances)
				if (!best || instance.updatedAt > best.instance.updatedAt) best = { hostId, instance };
		}
		if (best) this.select(best.hostId, best.instance.instanceId);
	}

	// ------------------------------------------------------------ selection & view

	select(hostId: string, instanceId: string): void {
		const prev = this.state.selection;
		if (prev && prev.hostId === hostId && prev.instanceId === instanceId) {
			// Re-selecting a broken view retries it.
			if (this.state.view && this.state.view.phase !== "ready") this.connections.get(hostId)?.resubscribe();
			return;
		}
		if (prev && prev.hostId !== hostId) this.connections.get(prev.hostId)?.setSubscription(null);
		const selection = { hostId, instanceId };
		this.set({
			selection,
			view: createView(instanceId),
			outbox: [],
			notice: null,
			targetChanged: null,
			aborting: false,
		});
		this.connections.get(hostId)?.setSubscription(instanceId);
		void this.registry.saveSelection(selection).catch(() => {});
	}

	/** Ask the Host for a fresh snapshot of the open instance. */
	resync(): void {
		const sel = this.state.selection;
		if (sel) this.connections.get(sel.hostId)?.resubscribe();
	}

	private onHostMessage(hostId: string, msg: Parameters<typeof reduceView>[1]): void {
		const { selection, view } = this.state;
		if (!selection || !view || selection.hostId !== hostId) return;
		const next = reduceView(view, msg, this.now());
		if (next === view) return;
		const patch: Partial<AppState> = { view: next };

		const sessionChanged =
			(view.phase === "ready" && next.phase === "resyncing") ||
			(msg.type === "subscribed" && !!view.session && !!next.session && view.session.id !== next.session.id);
		if (sessionChanged) {
			const draft = this.state.drafts[draftKey(selection)]?.trim();
			if (draft) patch.targetChanged = { to: next.session?.name || undefined };
			patch.outbox = this.state.outbox.filter((e) => e.state === "sending" || e.state === "unconfirmed");
		}
		if (view.phase === "ready" && next.phase === "resyncing") this.connections.get(hostId)?.resubscribe();
		if (msg.type === "event" && msg.event.type === "agent_settled")
			patch.outbox = (patch.outbox ?? this.state.outbox).filter((e) => e.state !== "queued");

		this.set(patch);
		this.reconcileOutbox(msg.type === "subscribed");
	}

	/** Removes outbox entries that now appear in the transcript. */
	private reconcileOutbox(afterResync: boolean): void {
		const { view, selection, outbox } = this.state;
		if (!view || !selection || !outbox.length) return;
		const key = draftKey(selection);
		let drafts = this.state.drafts;
		let notice = this.state.notice;
		const remaining: OutboxEntry[] = [];
		for (const entry of outbox) {
			if (entry.state !== "sending" && findDeliveredUserItem(view, entry.text, entry.known)) {
				if (entry.state === "unconfirmed") {
					if (sameText(drafts[key], entry.text)) drafts = { ...drafts, [key]: "" };
					if (notice?.kind === "unconfirmed") notice = null;
				}
				continue;
			}
			if (entry.state === "unconfirmed" && afterResync)
				notice = { kind: "unconfirmed", title: "届いたか未確認", text: UNCONFIRMED_AFTER_SYNC };
			remaining.push(entry);
		}
		if (remaining.length !== outbox.length || drafts !== this.state.drafts || notice !== this.state.notice)
			this.set({ outbox: remaining, drafts, notice });
	}

	// ------------------------------------------------------------ composer

	setDraft(text: string): void {
		const sel = this.state.selection;
		if (!sel) return;
		this.set({ drafts: { ...this.state.drafts, [draftKey(sel)]: text } });
	}

	dismissNotice(): void {
		this.set({ notice: null });
	}

	confirmTarget(): void {
		this.set({ targetChanged: null });
	}

	/** Why the composer cannot send right now (null = it can). */
	sendBlocker(): "no_instance" | "offline" | "loading" | "gone" | "sending" | "target_changed" | "empty" | null {
		const { selection, view, outbox, targetChanged, drafts } = this.state;
		if (!selection || !view) return "no_instance";
		if (this.connections.get(selection.hostId)?.state !== "connected") return "offline";
		if (view.phase === "gone") return "gone";
		if (view.phase !== "ready") return "loading";
		if (outbox.some((e) => e.state === "sending")) return "sending";
		if (targetChanged) return "target_changed";
		if (!drafts[draftKey(selection)]?.trim()) return "empty";
		return null;
	}

	async send(): Promise<void> {
		const { selection, view } = this.state;
		if (!selection || !view || this.sendBlocker() !== null) return;
		const conn = this.connections.get(selection.hostId);
		if (!conn) return;
		const key = draftKey(selection);
		const text = (this.state.drafts[key] ?? "").replace(/\s+$/, "");
		const id = this.deps.randomUUID();
		const entry: OutboxEntry = { id, text, state: "sending", known: userEntryIds(view), sentAt: this.now() };
		// A new send supersedes older unconfirmed ones (the user decided).
		this.set({ outbox: [...this.state.outbox.filter((e) => e.state !== "unconfirmed"), entry], notice: null });
		const request: Request<"prompt"> = {
			id,
			method: "prompt",
			params: { text },
			expectInstanceId: selection.instanceId,
			...(view.session ? { expectSessionId: view.session.id } : {}),
		};
		let res: Response;
		try {
			res = await conn.rc(selection.instanceId, request as Request);
		} catch (error) {
			const code = error instanceof RcError ? error.code : "outcome_unknown";
			if (code === "not_connected") this.finishSend(key, id, { remove: true, notice: rcErrorText("offline") });
			else this.markUnconfirmed(key, id);
			return;
		}
		if (res.ok) {
			const deliveredAs = (res.result as { deliveredAs?: OutboxEntry["deliveredAs"] }).deliveredAs ?? "prompt";
			this.finishSend(key, id, { clearDraft: text, deliveredAs });
			return;
		}
		const code = res.error.code;
		// The Host could not tell whether RC received it, or RC timed out: outcome unknown, never re-sent.
		if (code === "internal" || code === "timeout") {
			this.markUnconfirmed(key, id);
			return;
		}
		this.finishSend(key, id, {
			remove: true,
			notice: rcErrorText(code, res.error.message),
			targetChanged: code === "session_changed",
		});
	}

	private markUnconfirmed(key: string, id: string): void {
		if (!this.isCurrent(key)) return;
		this.set({
			outbox: this.state.outbox.map((e) => (e.id === id ? { ...e, state: "unconfirmed" as const } : e)),
			notice: { kind: "unconfirmed", title: "届いたか未確認", text: "再接続したら確認します（自動で再送しません）" },
		});
	}

	private isCurrent(key: string): boolean {
		const sel = this.state.selection;
		return !!sel && draftKey(sel) === key;
	}

	private finishSend(
		key: string,
		id: string,
		opts: {
			remove?: boolean;
			notice?: ChatNotice;
			clearDraft?: string;
			deliveredAs?: OutboxEntry["deliveredAs"];
			targetChanged?: boolean;
		},
	): void {
		let drafts = this.state.drafts;
		if (opts.clearDraft !== undefined && sameText(drafts[key], opts.clearDraft)) drafts = { ...drafts, [key]: "" };
		if (!this.isCurrent(key)) {
			this.set({ drafts });
			return;
		}
		const outbox = opts.remove
			? this.state.outbox.filter((e) => e.id !== id)
			: this.state.outbox.map((e) =>
					e.id === id
						? {
								...e,
								deliveredAs: opts.deliveredAs,
								state: opts.deliveredAs === "prompt" ? ("delivered" as const) : ("queued" as const),
							}
						: e,
				);
		const patch: Partial<AppState> = { drafts, outbox };
		if (opts.notice) patch.notice = opts.notice;
		if (opts.targetChanged) patch.targetChanged = { to: this.state.view?.session?.name || undefined };
		this.set(patch);
		this.reconcileOutbox(false);
	}

	async abort(): Promise<void> {
		const { selection, aborting } = this.state;
		if (!selection || aborting) return;
		const conn = this.connections.get(selection.hostId);
		if (conn?.state !== "connected") return;
		this.set({ aborting: true });
		try {
			const res = await conn.rc(selection.instanceId, {
				id: this.deps.randomUUID(),
				method: "abort",
				params: {},
				expectInstanceId: selection.instanceId,
			});
			if (!res.ok && this.isCurrent(draftKey(selection)))
				this.set({
					notice: { kind: "error", title: "停止できませんでした", text: res.error.message ?? res.error.code },
				});
		} catch {
			if (this.isCurrent(draftKey(selection)))
				this.set({
					notice: {
						kind: "error",
						title: "停止の結果を確認できません",
						text: "接続が切れました。状態を確認してください。",
					},
				});
		} finally {
			this.set({ aborting: false });
		}
	}
}
