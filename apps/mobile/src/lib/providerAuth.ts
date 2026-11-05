/**
 * Provider login / logout for one machine (packages/protocol/src/auth.ts). Pure TS, owned by one screen.
 *
 * - Every request goes to the target instance (expectInstanceId); the chat selection is never changed.
 * - At most one `auth_wait` at a time, sent again only after the previous answer. A lost wait resumes after
 *   reconnect through `auth_list` (read-only); nothing else is ever repeated automatically.
 * - Inputs (keys, codes) are passed straight to `respond` and never stored here.
 */
import {
	AUTH_MAX_WAIT_MS,
	type AuthFlow,
	type AuthProviderId,
	type AuthProviderInfo,
	type ParamsOf,
	type ProviderAuthType,
	type RcMethod,
	type ResultOf,
} from "@pimate/protocol";
import { RcError } from "./hostConnection";
import type { AppStore } from "./store";

export interface AuthTarget {
	hostId: string;
}

export interface AuthNotice {
	tone: "error" | "info";
	title: string;
	text: string;
}

export interface AuthState {
	phase: "checking" | "offline" | "old" | "ready";
	providers: AuthProviderInfo[] | null;
	/** The flow shown on screen (active, or the terminal result of one this screen followed). */
	flow: AuthFlow | null;
	busy: "check" | "begin" | "respond" | "cancel" | "logout" | null;
	/** A long poll is outstanding. */
	waiting: boolean;
	notice: AuthNotice | null;
}

export const flowActive = (flow: AuthFlow | null | undefined): boolean =>
	!!flow && (flow.status === "working" || flow.status === "input" || flow.status === "saving");

export interface ProviderGroup {
	name: string;
	/** `label` tells members of one row apart ("" for a single-member row). */
	members: { info: AuthProviderInfo; label: string }[];
}

// One row per vendor; ChatGPT login stays the legacy `openai-codex` device-code flow (Issue #104).
const GROUPS: { name: string; members: [AuthProviderId, string][] }[] = [
	{
		name: "OpenAI",
		members: [
			["openai", "API キー"],
			["openai-codex", "ChatGPT"],
		],
	},
	{ name: "Anthropic", members: [["anthropic", ""]] },
	{
		name: "OpenCode",
		members: [
			["opencode", "Zen"],
			["opencode-go", "Go"],
		],
	},
];

/** Rows for the providers the PC listed; a provider this app does not know gets its own row. */
export function providerGroups(providers: AuthProviderInfo[]): ProviderGroup[] {
	const known = new Set(GROUPS.flatMap((g) => g.members.map(([id]) => id as string)));
	return [
		...GROUPS.map((g) => ({
			name: g.name,
			members: g.members.flatMap(([id, label]) => {
				const info = providers.find((p) => p.id === id);
				return info ? [{ info, label }] : [];
			}),
		})),
		...providers.filter((p) => !known.has(p.id)).map((info) => ({ name: info.id, members: [{ info, label: "" }] })),
	].filter((g) => g.members.length);
}

const BROWSER_URL: Partial<Record<AuthProviderId, RegExp>> = {
	anthropic: /^https:\/\/claude\.ai\/oauth\/authorize\?[^\s#\\]*$/,
	"openai-codex": /^https:\/\/auth\.openai\.com\/codex\/device$/,
};

/** The authorization page to open on the user's tap, only if it is the provider's own HTTPS endpoint. */
export function authBrowserUrl(flow: AuthFlow | null): string | null {
	const a = flow?.authorization;
	if (!flow || !a || typeof a.url !== "string" || a.url.length > 8192) return null;
	if (!BROWSER_URL[flow.provider]?.test(a.url)) return null;
	if (flow.provider === "openai-codex" && !/^[-A-Za-z0-9]{1,64}$/.test(a.userCode ?? "")) return null;
	return a.url;
}

const UNKNOWN = "自動では再送しません。プロバイダーの状態を確認してください。";
const notice = (title: string, text = "", tone: AuthNotice["tone"] = "error"): AuthNotice => ({ tone, title, text });

type RcOutcome<M extends RcMethod> =
	| { ok: true; result: ResultOf<M> }
	| { ok: false; code: string /** May have been carried out. */; unknown: boolean };

export class ProviderAuthController {
	state: AuthState = { phase: "checking", providers: null, flow: null, busy: null, waiting: false, notice: null };
	private readonly listeners = new Set<() => void>();
	private disposed = false;
	private connected = false;
	private instanceId: string | null = null;
	private lastInstanceId: string | null = null;
	private reconnectCheck = false;
	/** An answer to respond was lost: if the flow then vanishes, whether it was saved is unknown. */
	private uncertain = false;
	private sawSaving = false;
	/** A begin whose reply was lost; the next list shows its flow if it was created (a new flow id). */
	private lostBegin: { provider: AuthProviderId; method: ProviderAuthType } | null = null;
	/** Flow id of the latest auth_list, to tell a recovered new flow from an earlier finished one. */
	private listedId: string | undefined;
	private offStore: (() => void) | null = null;

	/** This screen's hold on the Host's login Pi; ending it cannot release another screen's hold. */
	private readonly holdId: string;

	constructor(
		private readonly store: AppStore,
		readonly target: AuthTarget,
		private readonly randomUUID: () => string,
	) {
		this.holdId = randomUUID();
	}

	getState = (): AuthState => this.state;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	start(): void {
		if (this.offStore || this.disposed) return;
		this.offStore = this.store.subscribe(() => this.onStore());
		this.connected = this.live();
		void this.check();
	}

	/** Leaving the screen: stop, and cancel an interactive flow best-effort (never once saving started). */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.offStore?.();
		const flow = this.state.flow;
		if (flow && (flow.status === "working" || flow.status === "input"))
			void this.rc("auth_cancel", { flowId: flow.id }).catch(() => {});
		// A late begin receipt is still cancelled: the Host keeps the Pi for a grace period after the last hold.
		this.store.connection(this.target.hostId)?.endAuthSession(this.holdId);
		this.listeners.clear();
	}

	/** Fresh capability check + metadata; recovers an active flow (also one whose begin reply was lost). */
	async check(): Promise<void> {
		if (this.disposed || this.state.busy) return;
		if (!this.live()) return this.set({ phase: "offline" });
		const conn = this.store.connection(this.target.hostId)!;
		if (conn.info?.providerAuth !== true || conn.info.authSession !== true) return this.set({ phase: "old" });
		this.set({ busy: "check", ...(this.state.phase === "ready" ? {} : { phase: "checking" }) });
		let session: Awaited<ReturnType<typeof conn.authSession>>;
		try {
			session = await conn.authSession(this.randomUUID(), this.holdId);
		} catch {
			if (!this.disposed)
				this.set({
					busy: null,
					phase: this.live() ? "ready" : "offline",
					notice: notice("ログイン用の Pi を起動できませんでした", "PC を確認し、「状態を確認」を押してください。"),
				});
			return;
		}
		if (this.disposed) {
			conn.endAuthSession(this.holdId); // the hold may have been re-taken after a reconnect
			return;
		}
		if (!session.ok)
			return this.set({
				busy: null,
				phase: "ready",
				notice: notice("ログイン用の Pi を起動できませんでした", "PC を確認し、「状態を確認」を押してください。"),
			});
		if (
			this.lastInstanceId &&
			this.lastInstanceId !== session.instanceId &&
			(flowActive(this.state.flow) || this.lostBegin)
		) {
			this.lostBegin = null;
			this.lost();
		}
		this.instanceId = session.instanceId;
		this.lastInstanceId = session.instanceId;
		const hello = await this.rc("hello", {});
		if (this.disposed) return;
		if (!hello.ok) return this.set({ busy: null, ...this.failurePhase(), ...this.checkFailed(hello.code) });
		if (hello.result.snapshot?.providerAuth !== true) return this.set({ busy: null, phase: "old" });
		const list = await this.rc("auth_list", {});
		if (this.disposed) return;
		if (!list.ok) return this.set({ busy: null, ...this.failurePhase(), ...this.checkFailed(list.code) });
		this.set({ busy: null, phase: "ready", providers: list.result.providers ?? [] });
		this.adopt(list.result.flow);
	}

	async begin(provider: AuthProviderId, method: ProviderAuthType): Promise<void> {
		if (this.disposed || this.state.busy || this.state.phase !== "ready" || flowActive(this.state.flow)) return;
		if (provider === "openai" && method === "oauth")
			return this.set({ notice: this.errorNotice("unsupported", "開始できませんでした") });
		this.uncertain = false;
		this.sawSaving = false;
		this.lostBegin = null;
		this.set({ busy: "begin", notice: null, flow: null });
		const res = await this.rc("auth_begin", { provider, method });
		if (this.disposed) {
			// The screen left before the receipt: release the new flow (port / prompt) instead of holding it to the TTL.
			const late = res.ok ? res.result.flow : null;
			if (late && (late.status === "working" || late.status === "input"))
				void this.rc("auth_cancel", { flowId: late.id }).catch(() => {});
			return;
		}
		this.set({ busy: null });
		if (res.ok) return this.apply(res.result.flow);
		if (res.unknown) {
			this.lostBegin = { provider, method };
			this.set({
				notice: notice("開始できたか確認できません", "再接続後に自動で確認します。「状態を確認」でも確かめられます。"),
			});
			void this.check();
		} else if (res.code === "busy") {
			this.set({
				notice: notice("PC で別のログイン手続きが進行中です", "終わるまで待つか、表示された手続きを中止してください。"),
			});
			void this.check();
		} else this.set({ notice: this.errorNotice(res.code, "開始できませんでした") });
	}

	/** Submits once. The caller clears its input regardless of the outcome. */
	async respond(value: string): Promise<void> {
		const flow = this.state.flow;
		const v = value.trim();
		if (this.disposed || this.state.busy || flow?.status !== "input" || !flow.prompt || !v) return;
		this.set({ busy: "respond", notice: null });
		const res = await this.rc("auth_respond", { flowId: flow.id, promptId: flow.prompt.id, value: v });
		if (this.disposed) return;
		this.set({ busy: null });
		if (res.ok) return this.apply(res.result.flow);
		if (res.unknown) {
			this.uncertain = true;
			this.set({ notice: notice("送信できたか確認できません", `状態を確認しています。${UNKNOWN}`) });
			void this.check();
		} else if (res.code === "bad_request")
			this.set({ notice: notice("受け付けられませんでした", "形式を確認して、もう一度入力してください。") });
		else this.set({ notice: this.errorNotice(res.code, "送信できませんでした") });
	}

	async cancel(): Promise<void> {
		const flow = this.state.flow;
		if (this.disposed || this.state.busy || !flow || !flowActive(flow) || flow.status === "saving") return;
		this.set({ busy: "cancel", notice: null });
		const res = await this.rc("auth_cancel", { flowId: flow.id });
		if (this.disposed) return;
		this.set({ busy: null });
		if (res.ok) return this.apply(res.result.flow);
		if (res.code === "busy")
			this.set({ notice: notice("保存を始めたため中止できません", "結果が表示されるまでお待ちください。") });
		else if (res.unknown)
			this.set({ notice: notice("中止できたか確認できません", "「状態を確認」を押してください。") });
		else this.set({ notice: this.errorNotice(res.code, "中止できませんでした") });
	}

	async logout(provider: AuthProviderId): Promise<void> {
		if (this.disposed || this.state.busy || this.state.phase !== "ready" || flowActive(this.state.flow)) return;
		this.set({ busy: "logout", notice: null, flow: null });
		const res = await this.rc("auth_logout", { provider });
		if (this.disposed) return;
		if (!res.ok) {
			this.set({
				busy: null,
				notice: res.unknown
					? notice("ログアウトできたか確認できません", "「状態を確認」で現在の状態を確かめてください。")
					: this.errorNotice(res.code, "ログアウトできませんでした"),
			});
			return;
		}
		await this.refreshAfterChange();
		const info = this.state.providers?.find((p) => p.id === provider);
		const text = [
			"起動中の Pi には /reload または再起動後に反映されます。",
			this.state.notice?.text ?? "",
			info?.configured ? "環境変数など別の設定が残っているため、まだ使える場合があります。" : "",
		]
			.filter(Boolean)
			.join("");
		this.set({ busy: null, notice: notice("保存済みの認証情報を削除しました", text, "info") });
	}

	/** Back to the provider list after a finished flow (it is not shown again by later checks). */
	dismissFlow(): void {
		if (flowActive(this.state.flow)) return;
		this.set({ flow: null, notice: null });
	}

	// ------------------------------------------------------------ internals

	private live(): boolean {
		return this.store.connection(this.target.hostId)?.state === "connected";
	}

	private onStore(): void {
		if (this.disposed) return;
		const live = this.live();
		if (live === this.connected) return;
		this.connected = live;
		if (live) {
			if (this.state.busy) this.reconnectCheck = true;
			else {
				this.reconnectCheck = false;
				void this.check();
			}
		} else this.set({ phase: "offline" });
	}

	private failurePhase(): Partial<AuthState> {
		return this.live() ? {} : { phase: "offline" };
	}

	private checkFailed(code: string): Partial<AuthState> {
		if (code === "not_connected" || !this.live()) return {};
		return { phase: "ready", notice: this.errorNotice(code, "状態を取得できませんでした") };
	}

	private errorNotice(code: string, title: string): AuthNotice {
		switch (code) {
			case "not_found":
				return notice(title, "ログイン用の Pi が終了しました。「状態を確認」で再起動できます。");
			case "not_connected":
				return notice(title, "PC に接続していません。再接続してからお試しください。");
			case "not_ready":
				return notice(title, "Pi が準備中です。少し待ってから「状態を確認」を押してください。");
			case "unsupported":
				return notice(title, "この Pi ではこの方法を使えません。");
			case "busy":
				return notice(title, "PC で別の操作が進行中です。少し待ってからお試しください。");
			default:
				return notice(title, "PC の Pi で状態を確認してください。");
		}
	}

	/** auth_list's flow: active ones are followed; a terminal one only if this screen was following it. */
	private adopt(listed: AuthFlow | undefined): void {
		const current = this.state.flow;
		const begun = this.lostBegin;
		const previous = this.listedId;
		this.lostBegin = null;
		this.listedId = listed?.id;
		if (
			listed &&
			(flowActive(listed) ||
				current?.id === listed.id ||
				(begun && listed.id !== previous && listed.provider === begun.provider && listed.method === begun.method))
		) {
			this.apply(listed);
			return;
		}
		if (flowActive(current)) {
			this.lost();
			return;
		}
		if (begun)
			this.set({
				notice: notice("手続きは見つかりませんでした", "開始されなかったようです。必要ならもう一度始めてください。"),
			});
	}

	private apply(next: AuthFlow): void {
		const current = this.state.flow;
		if (current && next.id === current.id && next.revision < current.revision) return;
		this.listedId = next.id;
		if (next.status === "saving") this.sawSaving = true;
		// The runtime was lost while saving (or it failed storing): whether it was saved is unknown.
		const unknownSave =
			(this.sawSaving && (next.status === "cancelled" || next.status === "expired")) || next.error === "storage_failed";
		this.set({ flow: next, ...(unknownSave ? { notice: notice("保存されたか確認できません", UNKNOWN) } : {}) });
		if (flowActive(next)) void this.poll();
		else {
			this.uncertain = false;
			if (next.status === "succeeded" || unknownSave) void this.refreshAfterChange();
		}
	}

	/** The followed flow vanished (Pi reloaded / runtime recreated). */
	private lost(piEnded = false): void {
		const saving = this.sawSaving || this.state.flow?.status === "saving" || this.uncertain;
		this.uncertain = false;
		this.set({
			flow: null,
			notice: saving
				? notice(
						"保存されたか確認できません",
						`${piEnded ? "ログイン用の Pi が終了しました。「状態を確認」で再起動できます。" : ""}${UNKNOWN}`,
					)
				: notice(
						"ログインの手続きが終了しました",
						"ログイン用の Pi が終了したか手続きが中断されました。「状態を確認」で再起動できます。",
					),
		});
	}

	private async poll(): Promise<void> {
		if (this.state.waiting) return;
		this.set({ waiting: true });
		let polled: string | undefined;
		try {
			for (;;) {
				const flow = this.state.flow;
				polled = flow?.id;
				if (this.disposed || !flow || !flowActive(flow)) return;
				const res = await this.rc("auth_wait", {
					flowId: flow.id,
					afterRevision: flow.revision,
					waitMs: AUTH_MAX_WAIT_MS,
				});
				if (this.disposed || this.state.flow?.id !== flow.id) return;
				if (res.ok) {
					if (res.result.flow?.id !== flow.id) return;
					this.apply(res.result.flow);
					continue;
				}
				if (res.code === "not_found" || res.code === "not_ready") return this.lost(res.code === "not_found");
				// Lost connection: resumed by the reconnect check. Anything else: the user checks explicitly.
				if (res.code !== "not_connected" && res.code !== "outcome_unknown" && this.live())
					this.set({ notice: notice("進み具合を取得できませんでした", "「状態を確認」を押してください。") });
				return;
			}
		} finally {
			if (!this.disposed) {
				this.set({ waiting: false });
				// A newer flow began while an older wait was still out: follow it now (one request at a time).
				const next = this.state.flow;
				if (next && flowActive(next) && next.id !== polled) void this.poll();
			}
		}
	}

	private async refreshAfterChange(): Promise<void> {
		const list = await this.rc("auth_list", {});
		if (this.disposed) return;
		if (!list.ok) {
			if (list.code === "not_found") this.set({ notice: this.errorNotice(list.code, "状態を取得できませんでした") });
			return;
		}
		this.set({ providers: list.result.providers ?? [] });
	}

	private async rc<M extends RcMethod>(method: M, params: ParamsOf<M>): Promise<RcOutcome<M>> {
		const conn = this.store.connection(this.target.hostId);
		if (conn?.state !== "connected") return { ok: false, code: "not_connected", unknown: false };
		const instanceId = this.instanceId;
		if (!instanceId) return { ok: false, code: "not_found", unknown: false };
		try {
			const res = await conn.rc(instanceId, {
				id: this.randomUUID(),
				method,
				params,
				expectInstanceId: instanceId,
			});
			if (res.ok) return { ok: true, result: res.result as ResultOf<M> };
			const code = res.error.code;
			if (code === "not_found" && this.instanceId === instanceId) this.instanceId = null;
			// Host transport failures / RC timeouts come back as internal / timeout: the request may have run.
			return { ok: false, code, unknown: code === "internal" || code === "timeout" };
		} catch (error) {
			const code = error instanceof RcError ? error.code : "outcome_unknown";
			return { ok: false, code, unknown: code !== "not_connected" };
		}
	}

	private set(patch: Partial<AuthState>): void {
		if (this.disposed) return;
		// Older PCs may still advertise the removed OpenAI OAuth method.
		if (patch.providers)
			patch.providers = patch.providers.map((p) =>
				p.id === "openai" ? { ...p, methods: p.methods.filter((m) => m !== "oauth") } : p,
			);
		this.state = { ...this.state, ...patch };
		for (const l of this.listeners) l();
		if (patch.busy === null && this.reconnectCheck && this.live()) {
			this.reconnectCheck = false;
			queueMicrotask(() => void this.check());
		}
	}
}
