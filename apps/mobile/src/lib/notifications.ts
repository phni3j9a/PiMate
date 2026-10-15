import type { PiAlert } from "@pimate/protocol";
import type { KeyValueStorage } from "./hostRegistry";

export type NotificationCategory = "input" | "complete" | "failed";
export interface NotificationTarget {
	hostId: string;
	instanceId: string;
	sessionId: string;
}
export interface NotificationSettings {
	enabled: boolean;
	input: boolean;
	complete: boolean;
	failed: boolean;
}
export type NotificationPermission = "granted" | "denied" | "undetermined";
const DEFAULTS: NotificationSettings = { enabled: false, input: true, complete: true, failed: true };
const KEY = "pimate.notifications.v1";
const LABELS: Record<PiAlert["kind"], [NotificationCategory, string]> = {
	input: ["input", "Pi が入力を待っています"],
	complete: ["complete", "Pi の作業が完了しました"],
	failed: ["failed", "Pi の処理に失敗しました"],
	child_waiting: ["input", "サブエージェントの確認が必要です"],
	child_paused: ["input", "サブエージェントが一時停止しました"],
	child_failed: ["failed", "サブエージェントの処理に失敗しました"],
};

export function notificationTarget(value: unknown): NotificationTarget | null {
	if (!value || typeof value !== "object") return null;
	const v = value as Record<string, unknown>;
	if (![v.hostId, v.instanceId, v.sessionId].every((s) => typeof s === "string" && s.length > 0 && s.length <= 200))
		return null;
	return { hostId: v.hostId as string, instanceId: v.instanceId as string, sessionId: v.sessionId as string };
}

interface NotificationDeps {
	storage: KeyValueStorage;
	permission(request: boolean): Promise<NotificationPermission>;
	watch(enabled: boolean): void;
	visible(target: NotificationTarget): boolean;
	show(title: string, target: NotificationTarget): Promise<void>;
	clear(): Promise<void>;
}

/** Platform-free opt-in and deduplication policy. Only live Host alerts enter this class. */
export class NotificationCenter {
	private state = {
		loaded: false,
		busy: false,
		settings: { ...DEFAULTS },
		permission: "undetermined" as NotificationPermission,
		error: "",
	};
	private listeners = new Set<() => void>();
	private seen = new Set<string>();
	private saveQueue: Promise<void> = Promise.resolve();
	constructor(private deps: NotificationDeps) {}
	getState = () => this.state;
	subscribe = (fn: () => void) => {
		this.listeners.add(fn);
		return () => {
			this.listeners.delete(fn);
		};
	};
	private set(patch: Partial<typeof this.state>) {
		this.state = { ...this.state, ...patch };
		for (const listener of this.listeners) listener();
	}
	async init() {
		try {
			const raw = await this.deps.storage.getItem(KEY);
			const value = raw ? JSON.parse(raw) : {};
			const settings = { ...DEFAULTS };
			for (const key of Object.keys(settings) as (keyof NotificationSettings)[])
				if (typeof value?.[key] === "boolean") settings[key] = value[key];
			this.set({ settings });
		} catch {
			this.set({ error: "通知設定を読み込めませんでした。通知はオフのままです。" });
		}
		this.set({ loaded: true });
		await this.refreshPermission();
	}
	async refreshPermission() {
		try {
			this.set({ permission: await this.deps.permission(false) });
		} catch {
			this.set({ permission: "denied", error: "通知の許可を確認できませんでした。" });
		}
		this.watch();
	}
	private watch() {
		this.deps.watch(this.state.loaded && this.state.settings.enabled && this.state.permission === "granted");
	}
	async update(key: keyof NotificationSettings, value: boolean) {
		if (!this.state.loaded || this.state.busy) return;
		this.set({ busy: true, error: "" });
		try {
			if (key === "enabled" && value) this.set({ permission: await this.deps.permission(true) });
			const settings = { ...this.state.settings, [key]: value };
			// Never display enabled after a storage failure (restart must retain the same intent).
			this.saveQueue = this.saveQueue
				.catch(() => {})
				.then(() => this.deps.storage.setItem(KEY, JSON.stringify(settings)));
			await this.saveQueue;
			this.set({ settings });
			this.watch();
			if (key === "enabled" && !value) await this.deps.clear();
		} catch {
			this.set({ error: "通知設定を変更できませんでした。もう一度お試しください。" });
		} finally {
			this.set({ busy: false });
		}
	}
	async receive(hostId: string, alert: PiAlert) {
		if (!alert || typeof alert.id !== "string" || !Object.hasOwn(LABELS, alert.kind)) return;
		const target = notificationTarget({ ...alert, hostId });
		if (!target) return;
		const id = JSON.stringify([hostId, alert.id]);
		if (this.seen.has(id)) return;
		this.seen.add(id);
		if (this.seen.size > 1024) this.seen.delete(this.seen.values().next().value!);
		const [category, title] = LABELS[alert.kind];
		const { settings, permission, loaded } = this.state;
		if (!loaded || !settings.enabled || !settings[category] || permission !== "granted" || this.deps.visible(target))
			return;
		try {
			await this.deps.show(title, target);
			if (!this.state.settings.enabled) await this.deps.clear();
		} catch {
			this.set({ error: "通知を表示できませんでした。OS の通知設定を確認してください。" });
		}
	}
}
