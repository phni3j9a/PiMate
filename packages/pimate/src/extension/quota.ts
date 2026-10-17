/**
 * Subscription allowances carried by ordinary model responses (Issue #53). Only numbers are kept: no headers,
 * bodies or credentials leave this module, and nothing here makes a request of its own.
 * Every Pi process on the PC (incl. headless subagent runners) shares its latest numbers through the run dir,
 * so each Pi can show the PC-wide newest snapshot (Issue #59).
 *
 * - Codex OAuth: HTTP/SSE `x-codex-{primary,secondary}-*` headers, or the WebSocket `codex.rate_limits` event.
 * - Claude OAuth: `anthropic-ratelimit-unified-{5h,7d}-*` headers (utilization is a 0-1 fraction).
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { QuotaWindow, SubscriptionQuota } from "@pimate/protocol";
import { privateRunDir } from "../runtime.ts";

const FIVE_HOURS = 300;
const WEEK = 7 * 24 * 60;

function num(value: unknown): number | undefined {
	const n = typeof value === "string" && value.trim() ? Number(value) : value;
	return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/** Seconds since the epoch (milliseconds tolerated) -> epoch ms. */
function epochMs(value: unknown): number | undefined {
	const n = num(value);
	if (n === undefined || n <= 0) return undefined;
	return n > 1e12 ? n : n * 1000;
}

function window(minutes: unknown, usedPercent: unknown, resetsAt: unknown): QuotaWindow | null {
	const m = num(minutes);
	const used = num(usedPercent);
	// A window of unknown length cannot be labelled (Free/Go plans put a monthly window in the primary slot).
	if (m === undefined || m <= 0 || used === undefined) return null;
	const reset = epochMs(resetsAt);
	return { minutes: m, usedPercent: Math.min(100, Math.max(0, used)), ...(reset ? { resetsAt: reset } : {}) };
}

function quota(source: SubscriptionQuota["source"], windows: (QuotaWindow | null)[], now: number) {
	const found = windows.filter((w): w is QuotaWindow => w !== null).sort((a, b) => a.minutes - b.minutes);
	return found.length ? { source, windows: found, observedAt: now } : null;
}

export function quotaFromHeaders(headers: Record<string, string>, now: number): SubscriptionQuota | null {
	const h: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
	const codex = (slot: string) =>
		window(h[`x-codex-${slot}-window-minutes`], h[`x-codex-${slot}-used-percent`], h[`x-codex-${slot}-reset-at`]);
	const claude = (slot: string, minutes: number) => {
		const used = num(h[`anthropic-ratelimit-unified-${slot}-utilization`]);
		return window(minutes, used === undefined ? undefined : used * 100, h[`anthropic-ratelimit-unified-${slot}-reset`]);
	};
	return (
		quota("codex", [codex("primary"), codex("secondary")], now) ??
		quota("claude", [claude("5h", FIVE_HOURS), claude("7d", WEEK)], now)
	);
}

/** Codex WebSocket transport has no response headers; the same snapshot arrives as a stream event. */
export function quotaFromStreamEvent(data: unknown, now: number): SubscriptionQuota | null {
	if (!data || typeof data !== "object") return null;
	const e = data as Record<string, unknown>;
	if (e.type !== "codex.rate_limits") return null;
	// Model-specific meters (e.g. Spark) are separate allowances and must not replace the main one.
	const limit = e.metered_limit_name ?? e.limit_name;
	if (typeof limit === "string" && limit.trim() && limit.trim().toLowerCase().replace(/-/g, "_") !== "codex")
		return null;
	const limits = e.rate_limits && typeof e.rate_limits === "object" ? (e.rate_limits as Record<string, unknown>) : {};
	const slot = (key: string) => {
		const w = limits[key];
		if (!w || typeof w !== "object") return null;
		const r = w as Record<string, unknown>;
		return window(r.window_minutes, r.used_percent, r.reset_at);
	};
	return quota("codex", [slot("primary"), slot("secondary")], now);
}

const SOURCES = ["codex", "claude"] as const;
const quotaFile = (dir: string, source: SubscriptionQuota["source"]) => join(dir, `quota-${source}.json`);
export const isQuotaFile = (name: string | null) => !!name && SOURCES.some((s) => name === `quota-${s}.json`);

/** Re-validates a stored snapshot: the run dir is private, but a stale or foreign version must not reach the app. */
function parseShared(value: unknown, source: SubscriptionQuota["source"]): SubscriptionQuota | null {
	if (!value || typeof value !== "object") return null;
	const q = value as Record<string, unknown>;
	const at = num(q.observedAt);
	if (q.source !== source || !Array.isArray(q.windows) || at === undefined) return null;
	const windows = q.windows.map((w) => {
		const r = (w && typeof w === "object" ? w : {}) as Record<string, unknown>;
		return window(r.minutes, r.usedPercent, r.resetsAt);
	});
	return quota(source, windows, at);
}

export function readSharedQuotas(dir: string): SubscriptionQuota[] {
	return SOURCES.flatMap((source) => {
		try {
			const q = parseShared(JSON.parse(readFileSync(quotaFile(dir, source), "utf8")), source);
			return q ? [q] : [];
		} catch {
			return [];
		}
	});
}

/** Keeps the newest snapshot per source. Errors are the caller's to swallow: sharing must never break Pi. */
export function writeSharedQuota(dir: string, q: SubscriptionQuota): void {
	// shortcut: read-then-rename is not a cross-process lock; two writers in the same instant may keep the older one until the next response.
	const current = readSharedQuotas(dir).find((s) => s.source === q.source);
	if (current && current.observedAt >= q.observedAt) return;
	privateRunDir(dir);
	const file = quotaFile(dir, q.source);
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(q), { mode: 0o600 });
	renameSync(tmp, file);
}
