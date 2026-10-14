/**
 * App state: paired hosts and their connections, the selected instance's view, drafts and sends.
 * A tiny external store (read with useSyncExternalStore). Platform services are injected, so this stays testable.
 *
 * Sending rules (docs/SPEC.md §3): a prompt carries expectInstanceId / expectSessionId, is never inserted
 * optimistically and never re-sent. The draft stays until the Host confirms delivery.
 */
import type {
	FolderInfo,
	InstanceSummary,
	ModelInfo,
	ModelRef,
	PairingLink,
	PairResponse,
	ParamsOf,
	RcMethod,
	Request,
	Response,
	SessionListItem,
	SessionOp,
	SpawnParams,
	ThinkingLevel,
} from "@pimate/protocol";
import { type AuthFailure, type ConnectionState, HostConnection, RcError, type SocketLike } from "./hostConnection";
import { HostRegistry, type KeyValueStorage, type PairedHost, type Selection } from "./hostRegistry";
import {
	conversationLabel,
	createView,
	findDeliveredUserItem,
	type InstanceView,
	reduceView,
	userEntryIds,
} from "./instanceView";
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
	/** Session the message was sent to; delivery is only matched against that session's transcript. */
	sessionId?: string;
	sentAt: number;
}

export interface ChatNotice {
	kind: "error" | "unconfirmed" | "info";
	title?: string;
	text: string;
	/** Still in progress (shown with a spinner instead of a check). */
	busy?: boolean;
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
	/** Models of the selected instance (RC `models`), loaded once per selection. */
	models: ModelsState | null;
	/** A session/model operation started from the phone and not finished yet. */
	op: PendingOp | null;
	/** requestId of the dialog answer in flight. */
	answering: string | null;
}

export interface ModelsState {
	key: string;
	list: ModelInfo[] | null;
	error?: string;
}

export type OpKind = SessionOp | "compact" | "shutdown" | "model" | "thinking";

export interface PendingOp {
	kind: OpKind;
	key: string;
	/** fork: the text of the message the new branch starts from (offered as the draft). */
	forkText?: string;
	/** new / switch / fork: the session the op started from. Reaching another session also ends the op. */
	fromSessionId?: string;
}

export interface UIAnswer {
	value?: string;
	confirmed?: boolean;
	cancelled?: boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; title: string; text: string; code?: string };

/** Wait for a spawned instance to show up in the Host's list. */
export const SPAWN_APPEAR_TIMEOUT_MS = 20_000;

type FetchLike = Parameters<typeof pairWithHost>[2];

export type SendBlocker =
	| "no_instance"
	| "offline"
	| "loading"
	| "gone"
	| "sending"
	| "target_changed"
	| "dialog"
	| "pc_prompt"
	| "empty";

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

const OP_LABEL: Record<OpKind, string> = {
	new: "新しいセッション",
	switch: "セッションの切り替え",
	fork: "分岐",
	reload: "再読み込み",
	compact: "圧縮",
	shutdown: "終了",
	model: "モデルの変更",
	thinking: "Thinking の変更",
};

const SPAWN_ERRORS: Record<string, string> = {
	bad_request: "入力内容を確認してください。",
	not_found: "フォルダが見つかりません。",
	not_directory: "フォルダではありません。",
	unsupported: "この PC では起動できません（abduco が必要です）。",
};

const UNCONFIRMED_AFTER_SYNC =
	"届いたか確認できませんでした。履歴を確かめてから、必要なら送り直してください（自動で再送しません）";

function offlineText() {
	return { title: "接続していません", text: "PC に接続してから操作してください。" };
}

function rcErrorText(code: string, message?: string, notDone = "送信しませんでした"): ChatNotice {
	const send = notDone === "送信しませんでした";
	switch (code) {
		case "session_changed":
			return {
				kind: "error",
				title: notDone,
				text: send
					? "PC で会話が切り替わりました。宛先を確認してから送信してください。"
					: "PC で会話が切り替わりました。確認してからもう一度操作してください。",
			};
		case "instance_mismatch":
			return { kind: "error", title: notDone, text: "別の Pi に切り替わっていました。" };
		case "not_found":
			return { kind: "error", title: notDone, text: "この Pi は終了しています。" };
		case "no_such_request":
			return { kind: "error", title: notDone, text: "この質問はすでに終わっています。" };
		case "offline":
			return {
				kind: "error",
				title: send ? "送信していません" : notDone,
				text: send ? "PC に接続していません。再接続してから送信してください。" : "PC に接続していません。",
			};
		case "busy":
		case "not_ready":
			return {
				kind: "error",
				title: notDone,
				text: "Pi が受け付けられない状態でした。少し待ってからお試しください。",
			};
		case "unsupported":
			return { kind: "error", title: notDone, text: "この Pi（Remote Control）はこの操作に対応していません。" };
		default:
			return {
				kind: "error",
				title: send ? "送信できませんでした" : "操作できませんでした",
				text: message ? `${code}: ${message}` : code,
			};
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
		models: null,
		op: null,
		answering: null,
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
		if (!selection || selection.hostId !== hostId || conn?.state !== "connected" || !conn.instancesReceived) return;
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
			models: null,
			op: null,
			answering: null,
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
		let next = reduceView(view, msg, this.now());
		const key = draftKey(selection);
		// Operation results can arrive while the view resyncs after a session switch (the view drops those
		// events and waits for the snapshot), so they are matched here on the raw sequence instead.
		const opPatch =
			msg.type === "event" && msg.instanceId === selection.instanceId && msg.seq > view.seq
				? this.opEvent(key, msg.event)
				: {};
		if (next === view) {
			if (Object.keys(opPatch).length) this.set(opPatch);
			return;
		}
		const patch: Partial<AppState> = { ...opPatch };

		const sessionChanged =
			(view.phase === "ready" && next.phase === "resyncing") ||
			(msg.type === "subscribed" && !!view.session && !!next.session && view.session.id !== next.session.id);
		if (sessionChanged) {
			const op = this.state.op;
			// The phone switched on purpose: the draft simply follows, and the divider says who did it.
			const byPhone = !!op && op.key === key && (op.kind === "new" || op.kind === "switch" || op.kind === "fork");
			const draft = this.state.drafts[key]?.trim();
			if (draft && !byPhone) patch.targetChanged = { to: next.session?.name || undefined };
			if (byPhone && next.sessionNotice) next = { ...next, sessionNotice: { ...next.sessionNotice, byPhone: true } };
			patch.outbox = this.state.outbox.filter((e) => e.state === "sending" || e.state === "unconfirmed");
		}
		// `session_op_done` is not part of the snapshot: when it is emitted while the Host resyncs this view it
		// can be lost. The snapshot of another session is proof enough that the phone's switch happened.
		const pending = this.state.op;
		if (
			msg.type === "subscribed" &&
			pending?.key === key &&
			pending.fromSessionId &&
			next.session &&
			next.session.id !== pending.fromSessionId &&
			!("op" in opPatch)
		)
			Object.assign(patch, this.sessionOpDone(pending, key));
		// An unnamed conversation is known by its first message once its history has arrived.
		const target = patch.targetChanged ?? this.state.targetChanged;
		if (msg.type === "subscribed" && target && !target.to) {
			const to = conversationLabel(next.session, next.items);
			if (to) patch.targetChanged = { to };
		}
		patch.view = next;
		if (msg.type === "subscribed" && this.state.models?.key !== key) void this.loadModels();
		if (view.phase === "ready" && next.phase === "resyncing") this.connections.get(hostId)?.resubscribe();
		if (msg.type === "event" && msg.event.type === "agent_settled")
			patch.outbox = (patch.outbox ?? this.state.outbox).filter((e) => e.state !== "queued");

		this.set(patch);
		this.reconcileOutbox(msg.type === "subscribed");
	}

	/** Finishes phone-started operations from their result events. */
	private opEvent(key: string, event: Extract<Parameters<typeof reduceView>[1], { type: "event" }>["event"]) {
		const op = this.state.op?.key === key ? this.state.op : null;
		switch (event.type) {
			case "session_op_done": {
				if (!op || op.kind !== event.op) return {};
				if (event.error)
					return {
						op: null,
						notice: { kind: "error" as const, title: `${OP_LABEL[op.kind]}に失敗しました`, text: event.error },
					};
				if (event.cancelled)
					return {
						op: null,
						notice: {
							kind: "info" as const,
							text: `${OP_LABEL[op.kind]}は取り消されました（Pi の拡張機能などが止めました）`,
						},
					};
				return this.sessionOpDone(op, key);
			}
			case "compact_done":
				return op?.kind === "compact"
					? { op: null, notice: { kind: "info" as const, text: "コンテキストを圧縮しました" } }
					: {};
			case "compact_error":
				return op?.kind === "compact"
					? { op: null, notice: { kind: "error" as const, title: "圧縮できませんでした", text: event.error } }
					: {};
			default:
				return {};
		}
	}

	private sessionOpDone(op: PendingOp, key: string): Partial<AppState> {
		const patch: Partial<AppState> = { op: null };
		if (op.forkText && !this.state.drafts[key]?.trim()) patch.drafts = { ...this.state.drafts, [key]: op.forkText };
		return patch;
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
			if (
				entry.state !== "sending" &&
				view.session?.id === entry.sessionId &&
				findDeliveredUserItem(view, entry.text, entry.known)
			) {
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
	sendBlocker(): SendBlocker | null {
		const { selection, view, outbox, targetChanged, drafts } = this.state;
		if (!selection || !view) return "no_instance";
		if (this.connections.get(selection.hostId)?.state !== "connected") return "offline";
		if (view.phase === "gone") return "gone";
		if (view.phase !== "ready") return "loading";
		if (outbox.some((e) => e.state === "sending")) return "sending";
		if (targetChanged) return "target_changed";
		// Pi is waiting on a question: answer it first (in the chat, or on the PC).
		if (view.pendingUI.length) return "dialog";
		if (view.uiPrompt) return "pc_prompt";
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
		const entry: OutboxEntry = {
			id,
			text,
			state: "sending",
			known: userEntryIds(view),
			sessionId: view.session?.id,
			sentAt: this.now(),
		};
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
		if (opts.targetChanged) {
			const view = this.state.view;
			patch.targetChanged = { to: view ? conversationLabel(view.session, view.items) : undefined };
		}
		this.set(patch);
		this.reconcileOutbox(false);
	}

	async abort(): Promise<void> {
		const { selection, aborting, view } = this.state;
		// Without a known session the stop could hit a conversation the user is not looking at.
		const sessionId = view?.session?.id;
		if (!selection || aborting || !sessionId) return;
		const conn = this.connections.get(selection.hostId);
		if (conn?.state !== "connected") return;
		this.set({ aborting: true });
		try {
			const res = await conn.rc(selection.instanceId, {
				id: this.deps.randomUUID(),
				method: "abort",
				params: {},
				expectInstanceId: selection.instanceId,
				expectSessionId: sessionId,
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

	// ------------------------------------------------------------ operations (M2)

	/** Sends one RC request to the selected instance, guarded by its instance and session ids. */
	private async guardedRc<M extends RcMethod>(
		method: M,
		params: ParamsOf<M>,
		opts: { session?: boolean } = {},
	): Promise<Result<Response & { ok: true }>> {
		const { selection, view } = this.state;
		const conn = selection && this.connections.get(selection.hostId);
		if (!selection || !view || !conn || conn.state !== "connected") return { ok: false, ...offlineText() };
		const sessionId = view.session?.id;
		if (opts.session !== false && !sessionId)
			return { ok: false, title: "まだ準備中です", text: "会話を読み込んでから操作してください。" };
		const request: Request = {
			id: this.deps.randomUUID(),
			method,
			params: params as Request["params"],
			expectInstanceId: selection.instanceId,
			...(opts.session !== false && sessionId ? { expectSessionId: sessionId } : {}),
		};
		try {
			const res = await conn.rc(selection.instanceId, request);
			if (res.ok) return { ok: true, value: res };
			const n = rcErrorText(res.error.code, res.error.message, "操作しませんでした");
			return { ok: false, title: n.title ?? "操作できませんでした", text: n.text, code: res.error.code };
		} catch (error) {
			if (error instanceof RcError && error.code === "not_connected") return { ok: false, ...offlineText() };
			return {
				ok: false,
				title: "結果を確認できません",
				text: "接続が切れました。状態を確認してください（自動で再送しません）。",
			};
		}
	}

	/** Loads the selected instance's models (for the composer label and the model sheet). */
	async loadModels(): Promise<void> {
		const sel = this.state.selection;
		if (!sel) return;
		const key = draftKey(sel);
		this.set({ models: { key, list: this.state.models?.key === key ? this.state.models.list : null } });
		const res = await this.guardedRc("models", {}, { session: false });
		if (!this.isCurrent(key)) return;
		if (res.ok) {
			const list = (res.value.result as { models?: ModelInfo[] }).models ?? [];
			this.set({ models: { key, list } });
		} else this.set({ models: { key, list: this.state.models?.list ?? null, error: res.text } });
	}

	/** Models offered on a host (asked from any of its Pi instances; null when none answers). */
	async hostModels(hostId: string): Promise<{ models: ModelInfo[]; current: ModelRef | null } | null> {
		const conn = this.connections.get(hostId);
		if (conn?.state !== "connected") return null;
		const instances = [...conn.instances].sort((a, b) => b.updatedAt - a.updatedAt);
		for (const instance of instances.slice(0, 3)) {
			try {
				const res = await conn.rc(instance.instanceId, {
					id: this.deps.randomUUID(),
					method: "models",
					params: {},
					expectInstanceId: instance.instanceId,
				});
				if (res.ok) {
					const r = res.result as { models?: ModelInfo[]; current?: ModelRef | null };
					return { models: r.models ?? [], current: r.current ?? null };
				}
			} catch {
				return null;
			}
		}
		return null;
	}

	async folders(hostId: string): Promise<Result<{ home: string; folders: FolderInfo[] }>> {
		const conn = this.connections.get(hostId);
		if (conn?.state !== "connected") return { ok: false, ...offlineText() };
		try {
			const res = await conn.folders(this.deps.randomUUID());
			return { ok: true, value: { home: res.home, folders: res.folders } };
		} catch {
			return { ok: false, title: "フォルダの一覧を取得できませんでした", text: "接続を確認してください。" };
		}
	}

	/**
	 * Starts a new Pi and opens it once it appears in the Host's list. Never retried: if the outcome is unknown,
	 * the user is told to check the list instead.
	 */
	async spawn(hostId: string, params: SpawnParams): Promise<Result<{ instanceId: string }>> {
		const conn = this.connections.get(hostId);
		if (conn?.state !== "connected") return { ok: false, ...offlineText() };
		let res: Awaited<ReturnType<HostConnection["spawn"]>>;
		try {
			res = await conn.spawn(this.deps.randomUUID(), params);
		} catch (error) {
			if (error instanceof RcError && error.code === "not_connected") return { ok: false, ...offlineText() };
			return {
				ok: false,
				title: "起動したか確認できません",
				text: "接続が切れました。ドロワーの一覧を確認してから、必要ならもう一度起動してください（自動で再試行しません）。",
			};
		}
		if (res.ok && res.messageError)
			return {
				ok: false,
				title: "Pi は起動しましたが、最初のメッセージを送れませんでした",
				text: `届いたか分からないため再送していません。一覧から開いて確認してください（pimate attach ${res.abducoSession}）。`,
			};
		if (!res.ok) {
			const text = [SPAWN_ERRORS[res.code], res.message].filter(Boolean).join("\n") || res.code;
			return { ok: false, code: res.code, title: "起動できませんでした", text };
		}
		const appeared = await this.waitForInstance(hostId, res.instanceId);
		if (!appeared)
			return {
				ok: false,
				title: "起動しましたが、まだ一覧にありません",
				text: "少し待ってからドロワーの一覧を確認してください。",
			};
		this.select(hostId, res.instanceId);
		return { ok: true, value: { instanceId: res.instanceId } };
	}

	private waitForInstance(hostId: string, instanceId: string): Promise<boolean> {
		const conn = this.connections.get(hostId);
		const present = () => !!conn?.instances.some((i) => i.instanceId === instanceId);
		if (!conn || present()) return Promise.resolve(!!conn);
		return new Promise((resolve) => {
			const done = (ok: boolean) => {
				off();
				clearTimeout(timer);
				resolve(ok);
			};
			const off = conn.onChange(() => {
				if (present()) done(true);
				else if (this.connections.get(hostId) !== conn) done(false);
			});
			const timer = setTimeout(() => done(false), SPAWN_APPEAR_TIMEOUT_MS);
		});
	}

	async listSessions(): Promise<Result<SessionListItem[]>> {
		const res = await this.guardedRc("sessions", { limit: 50 }, { session: false });
		if (!res.ok) return res;
		return { ok: true, value: (res.value.result as { sessions?: SessionListItem[] }).sessions ?? [] };
	}

	/** Answers a dialog shown in the chat. Only for a request that is still pending in the open conversation. */
	async answerUI(requestId: string, answer: UIAnswer): Promise<void> {
		const { view, answering, selection } = this.state;
		if (!view || !selection || answering || !view.pendingUI.some((r) => r.requestId === requestId)) return;
		const key = draftKey(selection);
		this.set({ answering: requestId });
		const res = await this.guardedRc("ui_respond", { requestId, ...answer });
		if (!this.isCurrent(key)) return;
		const patch: Partial<AppState> = { answering: null };
		if (!res.ok) {
			const code = res.code;
			patch.notice = { kind: "error", title: "回答できませんでした", text: res.text };
			if (code === "no_such_request" && this.state.view)
				patch.view = {
					...this.state.view,
					pendingUI: this.state.view.pendingUI.filter((r) => r.requestId !== requestId),
				};
		}
		this.set(patch);
	}

	/** Session operations (new / switch / fork); the result arrives as `session_op_done`. */
	async sessionOp(op: "new" | "switch" | "fork", arg?: string, forkText?: string): Promise<Result<null>> {
		const fromSessionId = this.state.view?.session?.id;
		return this.startOp({ kind: op, forkText, fromSessionId }, "session_op", { op, ...(arg ? { arg } : {}) });
	}

	async compact(): Promise<Result<null>> {
		const res = await this.startOp({ kind: "compact" }, "compact", {});
		if (res.ok && this.state.op?.kind === "compact")
			this.set({ notice: { kind: "info", text: "コンテキストを圧縮しています…", busy: true } });
		return res;
	}

	async setModel(model: ModelRef): Promise<Result<null>> {
		return this.startOp({ kind: "model" }, "set_model", model, true);
	}

	async setThinking(level: ThinkingLevel): Promise<Result<null>> {
		return this.startOp({ kind: "thinking" }, "set_thinking", { level }, true);
	}

	/** Ends this Pi (RC `shutdown`). The instance then disappears from the list. */
	async shutdown(): Promise<Result<null>> {
		return this.startOp({ kind: "shutdown" }, "shutdown", {}, true);
	}

	private async startOp<M extends RcMethod>(
		op: Omit<PendingOp, "key">,
		method: M,
		params: ParamsOf<M>,
		finishOnResponse = false,
	): Promise<Result<null>> {
		const sel = this.state.selection;
		if (!sel) return { ok: false, title: "Pi が選ばれていません", text: "" };
		if (this.state.op) return { ok: false, title: "ほかの操作の途中です", text: "終わるまでお待ちください。" };
		const key = draftKey(sel);
		this.set({ op: { ...op, key } });
		const res = await this.guardedRc(method, params);
		if (!this.isCurrent(key)) return res.ok ? { ok: true, value: null } : res;
		if (!res.ok) {
			this.set({ op: null, notice: { kind: "error", title: res.title, text: res.text } });
			return res;
		}
		const current = this.state.op as PendingOp | null;
		if (finishOnResponse && current?.key === key && current.kind === op.kind) this.set({ op: null });
		return { ok: true, value: null };
	}
}
