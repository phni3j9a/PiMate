/** Pure view-model helpers for the drawer, chat header and settings (no React Native imports). */
import type { InstanceSummary, SubagentCounts } from "@pimate/protocol";
import { elapsed, instanceTitle, platformLabel, tildePath } from "./format";
import type { InstanceView } from "./instanceView";
import type { HostRuntime } from "./store";

export type Tone = "normal" | "waiting" | "failed";
export type Mark = "running" | "waiting" | "failed" | "done" | "idle";

export interface StatusLabel {
	mark: Mark;
	text: string;
	tone: Tone;
}

// ------------------------------------------------------------ drawer

export interface DrawerRow {
	key: string;
	hostId: string;
	instanceId: string;
	title: string;
	/** `~/code/demo` */
	path: string;
	mobile: boolean;
	status: InstanceSummary["status"];
	updatedAt: number;
	/** Subagent counts from the host list (shown even when the parent is idle); null when none / unsupported. */
	subagents: SubagentCounts | null;
}

export interface DrawerHostGroup {
	host: HostRuntime;
	rows: DrawerRow[];
}

export interface DrawerGroups {
	/** waiting_input instances, or ones with a subagent waiting, of connected hosts (要対応). */
	attention: DrawerRow[];
	hosts: DrawerHostGroup[];
}

function toRow(hostId: string, i: InstanceSummary): DrawerRow {
	return {
		key: `${hostId}/${i.instanceId}`,
		hostId,
		instanceId: i.instanceId,
		title: instanceTitle(i),
		path: tildePath(i.cwd),
		mobile: i.origin === "mobile",
		status: i.status,
		updatedAt: i.updatedAt,
		subagents: i.subagents ?? null,
	};
}

/** A row needs attention: the parent waits for input, or one of its subagents asks a question. */
export function needsAttention(row: DrawerRow): boolean {
	return row.status === "waiting_input" || (row.subagents?.waiting ?? 0) > 0;
}

/**
 * Subagent activity after the path (Drawer.html): "サブエージェント 2 実行中". Failures are left out — the counts
 * cover the run history, so they would stay forever.
 */
export function drawerSubagentText(c: SubagentCounts | null): string | null {
	if (!c) return null;
	const running = Math.max(0, c.active - c.waiting);
	const parts: string[] = [];
	if (running) parts.push(`${running} 実行中`);
	if (c.waiting) parts.push(`${c.waiting} 待ち`);
	if (c.paused) parts.push(`${c.paused} 一時停止`);
	return parts.length ? `サブエージェント ${parts.join(" · ")}` : null;
}

export function buildDrawerGroups(hosts: readonly HostRuntime[], query = ""): DrawerGroups {
	const q = query.trim().toLowerCase();
	const match = (row: DrawerRow, host: HostRuntime) =>
		!q || [row.title, row.path, host.hostName].some((s) => s.toLowerCase().includes(q));
	const attention: DrawerRow[] = [];
	const groups: DrawerHostGroup[] = [];
	for (const host of hosts) {
		const live = host.state === "connected";
		const rows = live
			? host.instances
					.map((i) => toRow(host.hostId, i))
					.filter((r) => match(r, host))
					.sort((a, b) => b.updatedAt - a.updatedAt)
			: [];
		attention.push(...rows.filter(needsAttention));
		groups.push({ host, rows: rows.filter((r) => !needsAttention(r)) });
	}
	attention.sort((a, b) => b.updatedAt - a.updatedAt);
	return { attention, hosts: groups };
}

export function hostConnectionLabel(host: HostRuntime): StatusLabel {
	switch (host.state) {
		case "connected":
			return { mark: "done", text: "接続中", tone: "normal" };
		case "connecting":
			return { mark: "running", text: "接続中…", tone: "normal" };
		case "offline":
			return { mark: "idle", text: "オフライン", tone: "normal" };
		case "auth_failed":
			return { mark: "failed", text: "再ペアリングが必要", tone: "failed" };
		default:
			return { mark: "idle", text: "停止中", tone: "normal" };
	}
}

/** Settings row subtitle: `接続中 · Linux · Pi 1 件`. */
export function hostSummary(host: HostRuntime): string {
	const parts = [hostConnectionLabel(host).text];
	if (host.state === "connected") {
		const platform = platformLabel(host.platform ?? undefined);
		if (platform) parts.push(platform);
		parts.push(`Pi ${host.instances.length} 件`);
	} else parts.push(host.address);
	return parts.join(" · ");
}

// ------------------------------------------------------------ chat header

/** Header status (作業中 · 1:04 / 入力待ち / 待機 / 再接続中 …), shown as mark + text. */
export function chatStatus(host: HostRuntime | undefined, view: InstanceView | null, now: number): StatusLabel | null {
	if (!host || !view) return null;
	if (host.state === "auth_failed") return { mark: "failed", text: "再ペアリングが必要", tone: "failed" };
	if (host.state !== "connected") return { mark: "running", text: "再接続中", tone: "normal" };
	switch (view.phase) {
		case "loading":
		case "resyncing":
			return { mark: "running", text: "同期中", tone: "normal" };
		case "error":
			return { mark: "failed", text: "接続できません", tone: "failed" };
		case "gone":
			return { mark: "idle", text: "終了", tone: "normal" };
	}
	if (view.uiPrompt && !view.pendingUI.length) return { mark: "waiting", text: "PC で操作待ち", tone: "waiting" };
	if (view.status === "waiting_input") return { mark: "waiting", text: "入力待ち", tone: "waiting" };
	if (view.status === "running") {
		const since = view.runningSince;
		return { mark: "running", text: since ? `作業中 · ${elapsed(now - since)}` : "作業中", tone: "normal" };
	}
	return { mark: "idle", text: "待機", tone: "normal" };
}

/** Title for the chat header: session name, else the folder; falls back to the drawer summary. */
export function chatTitle(view: InstanceView | null, summary: InstanceSummary | undefined): string {
	if (view?.cwd) return instanceTitle({ cwd: view.cwd, session: view.session ?? summary?.session ?? null });
	if (summary) return instanceTitle(summary);
	return "PiMate";
}
