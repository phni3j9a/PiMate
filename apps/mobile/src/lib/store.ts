/**
 * App state: paired hosts and their connections, the selected instance's view, drafts and sends.
 * A tiny external store (read with useSyncExternalStore). Platform services are injected, so this stays testable.
 *
 * Sending rules (docs/SPEC.md §3): a prompt carries expectInstanceId / expectSessionId, is never inserted
 * optimistically and never re-sent. The draft stays until the Host confirms delivery.
 */
import type {
	CommandInfo,
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
	SessionTree,
	SpawnParams,
	SubagentAction,
	SubagentTranscript,
	ThinkingLevel,
	ViewImage,
} from "@pimate/protocol";
import {
	MAX_IMAGE_PROMPT_TEXT,
	MAX_PROMPT_IMAGE_BYTES,
	type PromptImage,
	samePromptImages,
	validPromptImages,
} from "@pimate/protocol";
import { type BuiltinCommand, commandIntent } from "./commands";
import { EntryImageCache, validViewImage } from "./entryImages";
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
import { promptImageLimit } from "./promptImages";
import { clearFinishedWatch } from "./subagents";

export interface HostRuntime {
	hostId: string;
	hostName: string;
	address: string;
	pairedAt: number;
	state: ConnectionState;
	authFailure: AuthFailure | null;
	platform: string | null;
	alerts: boolean;
	instances: InstanceSummary[];
	nextRetryAt: number | null;
}

export type OutboxState = "sending" | "delivered" | "queued" | "unconfirmed";

export interface OutboxEntry {
	id: string;
	text: string;
	images?: PromptImage[];
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
	/** In-memory image drafts, like text drafts; never persisted or automatically re-sent. */
	attachments: Record<string, PromptImage[]>;
	/** Sends of the selected instance that are not (yet) visible in the transcript. */
	outbox: OutboxEntry[];
	notice: ChatNotice | null;
	/** The conversation behind the draft changed; sending needs an explicit confirmation. */
	targetChanged: { to?: string } | null;
	aborting: boolean;
	/** Models of the selected instance (RC `models`), loaded once per selection. */
	models: ModelsState | null;
	/** Command catalogs keyed by host/instance, replaced after session changes and reconnects. */
	commands: Record<string, CommandsState>;
	/** A session/model operation started from the phone and not finished yet. */
	op: PendingOp | null;
	/** requestId of the dialog answer in flight. */
	answering: string | null;
}

export interface CommandsState {
	sessionId: string | null;
	list: CommandInfo[] | null;
	error?: string;
}

export interface ModelsState {
	key: string;
	list: ModelInfo[] | null;
	/** Pi's scoped models ("favorites"); undefined when the RC is too old to report them. */
	scoped?: ModelRef[];
	error?: string;
}

export type OpKind = SessionOp | "compact" | "shutdown" | "model" | "thinking";

export interface OpTarget {
	hostId: string;
	instanceId: string;
	sessionId: string | null;
}

export interface PendingOp {
	kind: OpKind;
	key: string;
	/** fork: the text of the message the new branch starts from (offered as the draft). */
	forkText?: string;
	/** new / switch / fork: the session the op started from. Reaching another session also ends the op. */
	fromSessionId?: string;
	/** The Host accepted the request; only its result event is still awaited. */
	accepted?: boolean;
}

export interface UIAnswer {
	value?: string;
	confirmed?: boolean;
	cancelled?: boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; title: string; text: string; code?: string };

/** Wait for a spawned instance to show up in the Host's list. */
export const SPAWN_APPEAR_TIMEOUT_MS = 20_000;

import type { PiAlert } from "@pimate/protocol";
import type { NotificationTarget } from "./notifications";

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
	| "empty"
	| "images_unsupported"
	| "image_text_limit"
	| "image_count_limit";

export interface StoreDeps {
	onAlert?: (hostId: string, alert: PiAlert) => void;
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
	tree: "ツリーの移動",
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
			return {
				kind: "error",
				title: notDone,
				text: message || "この Pi（Remote Control）はこの操作に対応していません。",
			};
		default:
			return {
				kind: "error",
				title: send ? "送信できませんでした" : "操作できませんでした",
				text: message ? `${code}: ${message}` : code,
			};
	}
}

export class AppStore {
	/**
	 * A phone switch whose success arrived before the switch itself (the Host delivers result events ahead of
	 * the snapshot when it resyncs). Lets the following session change still count as the phone's own.
	 */
	private phoneSwitch: { key: string; fromSessionId: string; toSessionId: string } | null = null;
	private state: AppState = {
		loaded: false,
		hosts: [],
		selection: null,
		view: null,
		drafts: {},
		attachments: {},
		outbox: [],
		notice: null,
		targetChanged: null,
		aborting: false,
		models: null,
		commands: {},
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

	private alertsEnabled = false;
	setAlertsEnabled(enabled: boolean): void {
		this.alertsEnabled = enabled;
		for (const conn of this.connections.values()) conn.setAlertsEnabled(enabled);
	}

	private waitFor(check: () => boolean): Promise<void> {
		if (check()) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const off = this.subscribe(() => {
				if (check()) {
					clearTimeout(timer);
					off();
					resolve();
				}
			});
			const timer = setTimeout(() => {
				off();
				reject(new Error("接続を確認できませんでした。接続後にもう一度開いてください。"));
			}, 10000);
		});
	}

	/** Read-only validation before navigation. Never switches the PC's session or sends a prompt. */
	async openNotification(target: NotificationTarget, isActive: () => boolean = () => true): Promise<void> {
		await this.init();
		if (!this.records.has(target.hostId)) throw new Error("このマシンは登録されていません。");
		await this.waitFor(() => {
			const c = this.connections.get(target.hostId);
			return !!c && c.state === "connected" && c.instancesReceived;
		});
		const conn = this.connections.get(target.hostId)!;
		if (!conn.instances.some((i) => i.instanceId === target.instanceId)) throw new Error("この Pi は終了しています。");
		const result = await conn.rc(target.instanceId, {
			id: this.deps.randomUUID(),
			method: "hello",
			params: {},
			expectInstanceId: target.instanceId,
			expectSessionId: target.sessionId,
		});
		if (!result.ok) throw new Error("通知時のセッションではありません。現在の Pi は一覧から確認してください。");
		if (!isActive()) return;
		if (this.connections.get(target.hostId) !== conn)
			throw new Error("マシンの登録が変わりました。もう一度確認してください。");
		this.select(target.hostId, target.instanceId);
		await this.waitFor(
			() =>
				this.state.view?.phase === "ready" &&
				this.state.selection?.hostId === target.hostId &&
				this.state.selection.instanceId === target.instanceId,
		);
		if (this.state.view?.session?.id !== target.sessionId)
			throw new Error("通知後にセッションが切り替わりました。現在の Pi は一覧から確認してください。");
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
			alerts: c?.info?.alerts === true,
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
		conn.setAlertsEnabled(this.alertsEnabled);
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
		if (conn.state !== "connected") {
			const commands = Object.fromEntries(
				Object.entries(this.state.commands).filter(([key]) => !key.startsWith(`${hostId}/`)),
			);
			this.set({ commands });
		}
		const op = this.state.op;
		if (op?.accepted && conn.state !== "connected" && this.state.selection?.hostId === hostId)
			this.set({ hosts: this.runtimes(), ...this.opResultUnknown(op) });
		else this.set({ hosts: this.runtimes() });
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
		// An unselected Pi may have reloaded without an event reaching this subscription.
		const commands = { ...this.state.commands };
		delete commands[draftKey(selection)];
		this.set({
			commands,
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
		if (msg.type === "alert") {
			this.deps.onAlert?.(hostId, msg.alert);
			return;
		}
		const { selection, view } = this.state;
		if (!selection || !view || selection.hostId !== hostId) return;
		let next = reduceView(view, msg, this.now());
		const key = draftKey(selection);
		// Operation results can arrive while the view resyncs after a session switch (the view drops those
		// events and waits for the snapshot), so they are matched here on the raw sequence instead.
		const opPatch =
			msg.type === "event" && msg.instanceId === selection.instanceId && msg.seq > view.seq
				? this.opEvent(key, msg.event, msg.sessionId)
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
			patch.commands = { ...this.state.commands };
			delete patch.commands[key];
			const op = this.state.op;
			// The phone switched on purpose: the draft simply follows, and the divider says who did it.
			// Only an op started from the conversation being left counts (never a leftover one).
			const byOp =
				!!op &&
				op.key === key &&
				(op.kind === "new" || op.kind === "switch" || op.kind === "fork") &&
				!!op.fromSessionId &&
				op.fromSessionId === view.session?.id;
			const byPhone =
				byOp ||
				(this.phoneSwitch?.key === key &&
					this.phoneSwitch.fromSessionId === view.session?.id &&
					this.phoneSwitch.toSessionId === next.session?.id);
			const draft = this.state.drafts[key]?.trim() || this.state.attachments[key]?.length;
			if (draft && !byPhone && view.session?.id !== next.session?.id)
				patch.targetChanged = { to: next.session?.name || undefined };
			if (byPhone && next.sessionNotice) next = { ...next, sessionNotice: { ...next.sessionNotice, byPhone: true } };
			patch.outbox = this.state.outbox.filter((e) => e.state === "sending" || e.state === "unconfirmed");
		}
		if (sessionChanged || msg.type === "subscribed") this.phoneSwitch = null;
		// Result events are not part of the snapshot: one emitted while the Host builds it can be lost.
		const pending = this.state.op;
		if (msg.type === "subscribed" && pending?.key === key && !("op" in opPatch)) {
			// After the switch we saw begin, a snapshot of the very session it arrived at is proof that it
			// happened. Any other session (e.g. the PC switched again meanwhile) leaves the result unknown.
			if (
				view.phase === "resyncing" &&
				pending.fromSessionId &&
				next.session &&
				next.session.id !== pending.fromSessionId &&
				next.session.id === view.session?.id
			)
				Object.assign(patch, this.sessionOpDone(pending, key));
			// Otherwise an accepted op may have finished unseen: never wait for it forever.
			else if (pending.accepted) Object.assign(patch, this.opResultUnknown(pending));
		}
		// An unnamed conversation is known by its first message once its history has arrived.
		const target = patch.targetChanged ?? this.state.targetChanged;
		if (msg.type === "subscribed" && target && !target.to) {
			const to = conversationLabel(next.session, next.items);
			if (to) patch.targetChanged = { to };
		}
		patch.view = next;
		if (msg.type === "subscribed" && this.state.models?.key !== key) void this.loadModels();
		if (view.phase === "ready" && next.phase === "resyncing") this.connections.get(hostId)?.resubscribe();
		if (msg.type === "event" && msg.event.type === "agent_settled" && !msg.event.aborted)
			patch.outbox = (patch.outbox ?? this.state.outbox).filter((e) => e.state !== "queued");

		this.set(patch);
		this.reconcileOutbox(msg.type === "subscribed");
		if (msg.type === "event" && msg.event.type === "agent_settled" && msg.event.aborted)
			this.retainStoppedSends(key, msg.sessionId);
		if (msg.type === "subscribed" && next.slashCommands === true) void this.loadCommands();
	}

	/** Finishes phone-started operations from their result events. */
	private opEvent(
		key: string,
		event: Extract<Parameters<typeof reduceView>[1], { type: "event" }>["event"],
		sessionId: string | null,
	) {
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
				const v = this.state.view;
				if (op.kind === "tree" && (sessionId !== op.fromSessionId || v?.session?.id !== op.fromSessionId))
					return this.opResultUnknown(op);
				// The event carries the session the switch arrived at; only a move there is the phone's own.
				if (op.fromSessionId && sessionId && v?.phase === "ready" && v.session?.id === op.fromSessionId)
					this.phoneSwitch = { key, fromSessionId: op.fromSessionId, toSessionId: sessionId };
				const patch = this.sessionOpDone(op, key);
				if (op.kind === "tree") {
					if (event.editorText && !this.state.drafts[key]?.trim())
						patch.drafts = { ...this.state.drafts, [key]: event.editorText };
					patch.notice = {
						kind: "info",
						text:
							event.editorText && this.state.drafts[key]?.trim()
								? "移動しました。入力中の下書きはそのまま残しています。"
								: "移動しました",
					};
				}
				return patch;
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

	/** The result event of an accepted op can no longer arrive (disconnect / fresh snapshot). */
	private opResultUnknown(op: PendingOp): Partial<AppState> {
		return {
			op: null,
			notice: {
				kind: "error",
				title: `${OP_LABEL[op.kind]}の結果を確認できません`,
				text: "完了の知らせを受け取れませんでした。会話の状態を確かめてください（自動で再送しません）。",
			},
		};
	}

	/** Removes outbox entries that now appear in the transcript. */
	private reconcileOutbox(afterResync: boolean): void {
		const { view, selection, outbox } = this.state;
		if (!view || !selection || !outbox.length) return;
		const key = draftKey(selection);
		let drafts = this.state.drafts;
		let attachments = this.state.attachments;
		let notice = this.state.notice;
		const remaining: OutboxEntry[] = [];
		for (const entry of outbox) {
			if (
				entry.state !== "sending" &&
				view.session?.id === entry.sessionId &&
				findDeliveredUserItem(view, entry.text, entry.known, entry.images)
			) {
				if (entry.state === "unconfirmed") {
					if (sameText(drafts[key], entry.text) && samePromptImages(attachments[key], entry.images)) {
						drafts = { ...drafts, [key]: "" };
						attachments = { ...attachments, [key]: [] };
					}
					if (notice?.kind === "unconfirmed") notice = null;
				}
				continue;
			}
			if (entry.state === "unconfirmed" && afterResync)
				notice = {
					kind: "unconfirmed",
					title: "届いたか未確認",
					text: entry.images?.length
						? "画像はPiで変換される場合があり、履歴と自動照合できませんでした。履歴を確認してください（自動で再送しません）。"
						: UNCONFIRMED_AFTER_SYNC,
				};
			remaining.push(entry);
		}
		if (remaining.length !== outbox.length || drafts !== this.state.drafts || notice !== this.state.notice)
			this.set({ outbox: remaining, drafts, attachments, notice });
	}

	// ------------------------------------------------------------ composer

	setDraft(text: string): void {
		const sel = this.state.selection;
		if (!sel) return;
		this.set({ drafts: { ...this.state.drafts, [draftKey(sel)]: text } });
	}

	/** Reject a picker result if its original destination is no longer open. */
	setImages(images: PromptImage[], target: OpTarget): boolean {
		const current = this.opTarget();
		const previousCount = current ? (this.state.attachments[draftKey(current)]?.length ?? 0) : 0;
		if (
			!current ||
			!validPromptImages(images) ||
			// An older RC may lower the limit after reconnect; still allow individual removals from that draft.
			(images.length > (promptImageLimit(this.state.view) || 1) && images.length >= previousCount) ||
			current.hostId !== target.hostId ||
			current.instanceId !== target.instanceId ||
			current.sessionId !== target.sessionId ||
			this.state.view?.phase !== "ready"
		)
			return false;
		const key = draftKey(current);
		this.set({ attachments: { ...this.state.attachments, [key]: images } });
		return true;
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
		const images = this.state.attachments[draftKey(selection)] ?? [];
		if (images.length && view.promptImages !== true) return "images_unsupported";
		if (images.length > promptImageLimit(view)) return "image_count_limit";
		if (images.length && (drafts[draftKey(selection)]?.length ?? 0) > MAX_IMAGE_PROMPT_TEXT) return "image_text_limit";
		if (!drafts[draftKey(selection)]?.trim() && !images.length) return "empty";
		return null;
	}

	async send(): Promise<BuiltinCommand | undefined> {
		const { selection, view } = this.state;
		if (!selection || !view || this.sendBlocker() !== null) return;
		const conn = this.connections.get(selection.hostId);
		if (!conn) return;
		const key = draftKey(selection);
		const text = (this.state.drafts[key] ?? "").replace(/\s+$/, "");
		const images = this.state.attachments[key] ?? [];
		const catalog = this.state.commands[key];
		const intent =
			view.slashCommands === true
				? commandIntent(text, catalog?.list ?? [], view.sessionTree === true)
				: { kind: "text" as const };
		const refuse = (text: string) => this.set({ notice: { kind: "error", text } });
		if (intent.kind === "unknown") {
			refuse(
				catalog?.list
					? `/${intent.name} は使えません。一覧から選んでください。`
					: "コマンド一覧を取得してから送信してください。",
			);
			return;
		}
		if (intent.kind === "builtin") {
			if (intent.hasArgs || images.length) {
				refuse("アプリ操作には引数や画像を付けずに送信してください。");
				return;
			}
			if (this.state.op) {
				refuse("ほかの操作が終わるまでお待ちください。");
				return;
			}
			if (intent.name === "fork" && !view.items.some((i) => i.kind === "user")) {
				refuse("分岐できるメッセージがありません。");
				return;
			}
			if (intent.name === "new" || intent.name === "compact") {
				const result = await (intent.name === "new" ? this.sessionOp("new") : this.compact());
				if (!result.ok) return;
			} else this.set({ notice: null });
			if (sameText(this.state.drafts[key], text)) this.set({ drafts: { ...this.state.drafts, [key]: "" } });
			return intent.name === "new" || intent.name === "compact" ? undefined : intent.name;
		}
		if (intent.kind === "remote" && intent.command.source === "extension" && images.length) {
			refuse("Extension コマンドには画像を添付できません。");
			return;
		}
		const expandTemplates = intent.kind === "remote";
		const id = this.deps.randomUUID();
		const entry: OutboxEntry = {
			id,
			text,
			...(images.length ? { images } : {}),
			state: "sending",
			known: userEntryIds(view),
			sessionId: view.session?.id,
			sentAt: this.now(),
		};
		// A manual retry supersedes only the matching unconfirmed send, not other stopped drafts.
		this.set({
			outbox: [
				...this.state.outbox.filter(
					(e) => e.state !== "unconfirmed" || e.text !== text || !samePromptImages(e.images, images),
				),
				entry,
			],
			notice: null,
		});
		const request: Request<"prompt"> = {
			id,
			method: "prompt",
			params: {
				text,
				...(expandTemplates ? { expandTemplates: true } : {}),
				...(images.length ? { images } : {}),
				// Pi applies this only while busy; sending it even when apparently idle avoids a PC-start race.
				deliverAs: "steer",
			},
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
			// A stop can settle before this ACK; acceptance must not erase the recovered draft.
			if (this.isCurrent(key) && !this.state.outbox.some((e) => e.id === id && e.state === "sending")) {
				this.reconcileOutbox(false);
				return;
			}
			const deliveredAs =
				(res.result as { deliveredAs?: "command" | OutboxEntry["deliveredAs"] }).deliveredAs ?? "prompt";
			if (deliveredAs === "command") {
				this.finishSend(key, id, { remove: true, clearDraft: text, clearImages: images });
				return;
			}
			const showImageReceipt =
				images.length > 0 &&
				this.isCurrent(key) &&
				this.state.view?.session?.id === entry.sessionId &&
				this.state.outbox.some((e) => e.id === id && e.state === "sending");
			// Pi may resize/re-encode images and add dimension hints before persisting the user entry.
			// An ACK confirms acceptance, not an identical future transcript item: never keep a duplicate bubble.
			this.finishSend(key, id, {
				clearDraft: text,
				clearImages: images,
				deliveredAs,
				...((images.length || expandTemplates) && deliveredAs === "prompt" ? { remove: true } : {}),
				...(showImageReceipt
					? {
							notice: {
								kind: "info" as const,
								title: "画像付きメッセージを受け付けました",
								text:
									deliveredAs === "steer"
										? "割り込みとして受け付けました。反映は履歴で確認してください。"
										: deliveredAs === "followUp"
											? "完了後に送る依頼として受け付けました。反映は履歴で確認してください。"
											: "履歴に反映されるまでお待ちください。",
							},
						}
					: {}),
			});
			// The subagent summary of finished runs ends with the next prompt (also when it is queued).
			const v = this.state.view;
			if (v && this.isCurrent(key)) {
				const watch = clearFinishedWatch(v.subagentWatch, v.subagents.runs);
				if (watch !== v.subagentWatch) this.set({ view: { ...v, subagentWatch: watch } });
			}
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
			notice: {
				kind: "unconfirmed",
				title: "届いたか未確認",
				text: this.state.outbox.find((e) => e.id === id)?.images?.length
					? "Piが画像を変換する場合があり、自動では確認できないことがあります。履歴を確認してください（自動で再送しません）。"
					: "再接続したら確認します（自動で再送しません）",
			},
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
			clearImages?: PromptImage[];
			deliveredAs?: OutboxEntry["deliveredAs"];
			targetChanged?: boolean;
		},
	): void {
		let drafts = this.state.drafts;
		let attachments = this.state.attachments;
		if (
			opts.clearDraft !== undefined &&
			sameText(drafts[key], opts.clearDraft) &&
			samePromptImages(attachments[key], opts.clearImages)
		) {
			drafts = { ...drafts, [key]: "" };
			attachments = { ...attachments, [key]: [] };
		}
		if (!this.isCurrent(key)) {
			this.set({ drafts, attachments });
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
		const patch: Partial<AppState> = { drafts, attachments, outbox };
		if (opts.notice) patch.notice = opts.notice;
		if (opts.targetChanged) {
			const view = this.state.view;
			patch.targetChanged = { to: view ? conversationLabel(view.session, view.items) : undefined };
		}
		this.set(patch);
		this.reconcileOutbox(false);
	}

	/** TUI abort restores queued input on the PC, not in the transcript. Keep a phone copy too. */
	private retainStoppedSends(key: string, sessionId: string | null): void {
		const { view } = this.state;
		if (!view || !this.isCurrent(key) || view.session?.id !== sessionId) return;
		const pending = this.state.outbox.filter(
			(e) =>
				e.sessionId === sessionId &&
				(e.state === "queued" || e.state === "sending") &&
				!findDeliveredUserItem(view, e.text, e.known, e.images),
		);
		if (!pending.length) return;
		this.set({
			outbox: this.state.outbox.map((e) => (pending.includes(e) ? { ...e, state: "unconfirmed" as const } : e)),
			notice: {
				kind: "unconfirmed",
				title: "割り込みが届いていない可能性があります",
				text: "停止前の指示を未確認の下書きとして残しました。履歴を確認してから、必要なら入力欄へ戻してください（自動で再送しません）。",
			},
		});
	}

	/** Restores one uncertain send only into an empty composer; never sends it. */
	restoreOutboxDraft(id: string): boolean {
		const { selection, view, drafts, attachments, outbox } = this.state;
		if (!selection || view?.phase !== "ready") return false;
		const key = draftKey(selection);
		const entry = outbox.find((e) => e.id === id && e.state === "unconfirmed" && e.sessionId === view.session?.id);
		if (!entry || drafts[key] || attachments[key]?.length) return false;
		const remaining = outbox.filter((e) => e !== entry);
		this.set({
			drafts: { ...drafts, [key]: entry.text },
			attachments: { ...attachments, [key]: entry.images ?? [] },
			outbox: remaining,
			...(!remaining.some((e) => e.state === "unconfirmed") && this.state.notice?.kind === "unconfirmed"
				? { notice: null }
				: {}),
		});
		return true;
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
			if (res.ok || res.error.code === "timeout" || res.error.code === "internal") {
				this.reconcileOutbox(false);
				this.retainStoppedSends(draftKey(selection), sessionId);
			}
			if (
				!res.ok &&
				this.isCurrent(draftKey(selection)) &&
				(!["timeout", "internal"].includes(res.error.code) || this.state.notice?.kind !== "unconfirmed")
			)
				this.set({
					notice: { kind: "error", title: "停止できませんでした", text: res.error.message ?? res.error.code },
				});
		} catch {
			this.retainStoppedSends(draftKey(selection), sessionId);
			if (this.isCurrent(draftKey(selection)) && this.state.notice?.kind !== "unconfirmed")
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
		opts: { session?: boolean; discardStale?: boolean } = {},
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
			const response = await conn.rc(selection.instanceId, request);
			const stale =
				opts.discardStale && (!this.isCurrent(draftKey(selection)) || this.state.view?.session?.id !== sessionId);
			const res = stale ? { ok: false as const, error: { code: "session_changed", message: undefined } } : response;
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
		const prev = this.state.models?.key === key ? this.state.models : null;
		this.set({ models: { key, list: prev?.list ?? null, scoped: prev?.scoped } });
		const res = await this.guardedRc("models", {}, { session: false });
		if (!this.isCurrent(key)) return;
		if (res.ok) {
			const r = res.value.result as { models?: ModelInfo[]; scoped?: ModelRef[] };
			this.set({ models: { key, list: r.models ?? [], scoped: r.scoped } });
		} else this.set({ models: { ...(this.state.models ?? { key, list: null }), key, error: res.text } });
	}

	/** Cache only for this instance/session; stale replies never overwrite a replacement catalog. */
	async loadCommands(force = false): Promise<void> {
		const { selection, view } = this.state;
		if (!selection || view?.phase !== "ready" || view.slashCommands !== true) return;
		const key = draftKey(selection);
		const sessionId = view.session?.id ?? null;
		const prev = this.state.commands[key];
		if (!force && prev?.sessionId === sessionId) return;
		const pending: CommandsState = { sessionId, list: null };
		this.set({ commands: { ...this.state.commands, [key]: pending } });
		const res = await this.guardedRc("commands", {}, { discardStale: true });
		if (this.state.commands[key] !== pending) return;
		this.set({
			commands: {
				...this.state.commands,
				[key]: res.ok
					? { sessionId, list: (res.value.result as { commands: CommandInfo[] }).commands }
					: { sessionId, list: null, error: res.text || res.title },
			},
		});
	}

	/** Saves the favorites as Pi's scoped models (global `enabledModels`); empty = all models. */
	async setScopedModels(models: ModelRef[]): Promise<Result<null>> {
		const key = this.state.selection ? draftKey(this.state.selection) : null;
		const res = await this.guardedRc("set_scoped_models", { models }, { session: false });
		if (!res.ok) return res;
		const scoped = (res.value.result as { scoped?: ModelRef[] }).scoped ?? models;
		if (key && this.state.models?.key === key) this.set({ models: { ...this.state.models, scoped } });
		return { ok: true, value: null };
	}

	/** Models offered on a host (asked from any of its Pi instances; null when none answers). */
	async hostModels(
		hostId: string,
	): Promise<{ models: ModelInfo[]; current: ModelRef | null; scoped?: ModelRef[] } | null> {
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
					const r = res.result as { models?: ModelInfo[]; current?: ModelRef | null; scoped?: ModelRef[] };
					return { models: r.models ?? [], current: r.current ?? null, scoped: r.scoped };
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
	 * the user is told to check the list instead. `wanted` is asked at the end: when the caller has gone away
	 * meanwhile, the new Pi is left in the list instead of replacing what the user is looking at now.
	 */
	async spawn(
		hostId: string,
		params: SpawnParams,
		wanted: () => boolean = () => true,
	): Promise<Result<{ instanceId: string }>> {
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
		if (wanted()) this.select(hostId, res.instanceId);
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

	private readonly displayImageCache = new EntryImageCache();

	/** Display-only images: target-bound, shared in-flight and retained only in a bounded memory LRU. */
	entryImage(target: OpTarget, entryId: string, index: number, thumbnail = false): Promise<ViewImage> {
		return this.displayImage(target, "entry_image", { entryId, index, thumbnail });
	}

	fileImage(target: OpTarget & { cwd: string | null }, path: string, thumbnail = false): Promise<ViewImage> {
		return this.displayImage(target, "file_image", { path, thumbnail }, target.cwd);
	}

	private async displayImage<M extends "entry_image" | "file_image">(
		target: OpTarget,
		method: M,
		params: ParamsOf<M>,
		cwd?: string | null,
	): Promise<ViewImage> {
		const current = () => {
			const now = this.opTarget();
			return (
				now?.hostId === target.hostId &&
				now.instanceId === target.instanceId &&
				now.sessionId === target.sessionId &&
				(method !== "file_image" || this.state.view?.cwd === cwd)
			);
		};
		if (!current() || this.state.view?.phase !== "ready")
			throw new Error("会話が変わりました。チャットを開き直してください。");
		if (this.state.view[method === "entry_image" ? "entryImages" : "fileImages"] !== true)
			throw new Error("PC の PiMate を更新してください。");
		const key = JSON.stringify([target.hostId, target.instanceId, target.sessionId, cwd, method, params]);
		const image = await this.displayImageCache.load(key, async () => {
			if (!current()) throw new Error("会話が変わりました。");
			const res = await this.guardedRc(method, params, { discardStale: true });
			if (!res.ok) throw new Error(res.text);
			const value = (res.value.result as { image?: unknown }).image;
			// Older RCs may ignore thumbnail: never retain their large originals in mounted tiles.
			if (!validViewImage(value, params.thumbnail ? MAX_PROMPT_IMAGE_BYTES : undefined))
				throw new Error("画像を読み込めませんでした。");
			return {
				mimeType: value.mimeType,
				data: value.data,
				...(typeof value.width === "number" && Number.isFinite(value.width) && value.width > 0
					? { width: value.width }
					: {}),
				...(typeof value.height === "number" && Number.isFinite(value.height) && value.height > 0
					? { height: value.height }
					: {}),
			};
		});
		if (!current()) throw new Error("会話が変わりました。");
		return image;
	}

	// ------------------------------------------------------------ subagents (M4)

	/** Texts sent to children from this phone, per `runId/childId` (to label them in the work record). */
	private subagentSent = new Map<string, { text: string; action: SubagentAction }[]>();

	sentToSubagent(runId: string, childId: string): readonly { text: string; action: SubagentAction }[] {
		return this.subagentSent.get(`${runId}/${childId}`) ?? [];
	}

	/** A child's work record (newer items only when `cursor` is given). Only for the selected instance. */
	async subagentTranscript(
		instanceId: string,
		runId: string,
		childId: string,
		cursor?: string,
	): Promise<Result<SubagentTranscript>> {
		if (this.state.selection?.instanceId !== instanceId)
			return { ok: false, title: "読み込めませんでした", text: "この Pi は表示されていません。" };
		const res = await this.guardedRc(
			"subagent_transcript",
			{ runId, childId, ...(cursor ? { cursor } : {}) },
			{ discardStale: true },
		);
		if (!res.ok) return { ...res, title: "作業記録を読み込めませんでした" };
		const t = res.value.result as Partial<SubagentTranscript>;
		return {
			ok: true,
			value: {
				task: typeof t.task === "string" ? t.task : undefined,
				items: Array.isArray(t.items) ? t.items : [],
				cursor: typeof t.cursor === "string" ? t.cursor : (cursor ?? ""),
				truncated: t.truncated === true,
			},
		};
	}

	/** Runs one subagent operation the RC offered (`actions`). Errors come back for inline display. */
	async subagentControl(
		instanceId: string,
		params: { runId: string; childId?: string; action: SubagentAction; text?: string },
	): Promise<Result<{ message?: string; newRunId?: string }>> {
		if (this.state.selection?.instanceId !== instanceId)
			return { ok: false, title: "操作しませんでした", text: "この Pi は表示されていません。" };
		const res = await this.guardedRc("subagent_control", params, { discardStale: true });
		if (!res.ok) return res;
		if (params.text && params.childId) {
			const key = `${params.runId}/${params.childId}`;
			this.subagentSent.set(key, [...(this.subagentSent.get(key) ?? []), { text: params.text, action: params.action }]);
		}
		const r = (res.value.result ?? {}) as { message?: unknown; newRunId?: unknown };
		return {
			ok: true,
			value: {
				message: typeof r.message === "string" ? r.message : undefined,
				newRunId: typeof r.newRunId === "string" ? r.newRunId : undefined,
			},
		};
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

	private treeTarget(target: OpTarget): Result<null> {
		const now = this.opTarget();
		if (
			!now ||
			now.hostId !== target.hostId ||
			now.instanceId !== target.instanceId ||
			now.sessionId !== target.sessionId
		)
			return { ok: false, title: "会話が変わりました", text: "チャットからツリーを開き直してください。" };
		if (this.state.view?.phase !== "ready")
			return { ok: false, title: "会話を同期しています", text: "少し待ってからお試しください。" };
		if (!this.state.view.sessionTree)
			return { ok: false, title: "未対応です", text: "PC の PiMate を更新してください。" };
		return { ok: true, value: null };
	}

	async sessionTree(target: OpTarget): Promise<Result<SessionTree>> {
		const check = this.treeTarget(target);
		if (!check.ok) return check;
		const res = await this.guardedRc("session_tree", {}, { discardStale: true });
		return res.ok ? { ok: true, value: res.value.result as SessionTree } : res;
	}

	async navigateTree(target: OpTarget, entryId: string, summarize: boolean): Promise<Result<null>> {
		const check = this.treeTarget(target);
		if (!check.ok) return check;
		if (this.state.view?.agentActive || this.state.view?.status !== "idle")
			return { ok: false, title: "実行中は移動できません", text: "Pi の処理が終わるまでお待ちください。" };
		this.set({ notice: null });
		return this.startOp({ kind: "tree", fromSessionId: target.sessionId ?? undefined }, "session_op", {
			op: "tree",
			arg: entryId,
			summarize,
		});
	}

	async setTreeLabel(target: OpTarget, entryId: string, label: string): Promise<Result<null>> {
		const check = this.treeTarget(target);
		if (!check.ok) return check;
		const res = await this.guardedRc("set_label", { entryId, label }, { discardStale: true });
		return res.ok ? { ok: true, value: null } : res;
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

	/** What an operation confirmed by the user applies to (captured when the confirmation opens). */
	opTarget(): OpTarget | null {
		const { selection, view } = this.state;
		if (!selection || !view) return null;
		return { hostId: selection.hostId, instanceId: selection.instanceId, sessionId: view.session?.id ?? null };
	}

	/** Ends the Pi the user confirmed (RC `shutdown`), unless the chat moved on meanwhile. */
	async shutdown(target: OpTarget): Promise<Result<null>> {
		const now = this.opTarget();
		if (
			!now ||
			now.hostId !== target.hostId ||
			now.instanceId !== target.instanceId ||
			now.sessionId !== target.sessionId
		) {
			const res = {
				ok: false as const,
				title: "終了しませんでした",
				text: "確認しているあいだに表示中の Pi か会話が変わりました。もう一度選んでください。",
			};
			if (now) this.set({ notice: { kind: "error", title: res.title, text: res.text } });
			return res;
		}
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
		if (current?.key === key && current.kind === op.kind)
			this.set({ op: finishOnResponse ? null : { ...current, accepted: true } });
		return { ok: true, value: null };
	}
}
