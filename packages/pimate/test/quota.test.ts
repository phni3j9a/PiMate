import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SubscriptionQuota } from "@pimate/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hub } from "../src/extension/hub.ts";
import { quotaFromHeaders, quotaFromStreamEvent, readSharedQuotas, writeSharedQuota } from "../src/extension/quota.ts";

const NOW = 1_792_200_000_000;

describe("subscription quota", () => {
	it("reads Claude unified headers (0-1 fraction, reset in seconds)", () => {
		expect(
			quotaFromHeaders(
				{
					"anthropic-ratelimit-unified-7d-utilization": "0.65",
					"anthropic-ratelimit-unified-7d-reset": "1792519200",
					"Anthropic-Ratelimit-Unified-5h-Utilization": "0.11",
					"anthropic-ratelimit-unified-5h-reset": "1792206000",
					"anthropic-ratelimit-unified-status": "allowed",
					authorization: "never copied",
				},
				NOW,
			),
		).toEqual({
			source: "claude",
			windows: [
				{ minutes: 300, usedPercent: 11, resetsAt: 1_792_206_000_000 },
				{ minutes: 10080, usedPercent: 65, resetsAt: 1_792_519_200_000 },
			],
			observedAt: NOW,
		});
	});

	it("reads Codex HTTP headers and ignores other meters", () => {
		expect(
			quotaFromHeaders(
				{
					"x-codex-primary-used-percent": "12.5",
					"x-codex-primary-window-minutes": "300",
					"x-codex-primary-reset-at": "1792206000",
					"x-codex-secondary-used-percent": "140",
					"x-codex-secondary-window-minutes": "10080",
					"x-codex-other-primary-used-percent": "99",
				},
				NOW,
			),
		).toEqual({
			source: "codex",
			windows: [
				{ minutes: 300, usedPercent: 12.5, resetsAt: 1_792_206_000_000 },
				{ minutes: 10080, usedPercent: 100 },
			],
			observedAt: NOW,
		});
	});

	it("returns null without usable quota data", () => {
		expect(quotaFromHeaders({ "content-type": "text/event-stream" }, NOW)).toBeNull();
		// A window of unknown length cannot be labelled; garbage numbers are not 0%.
		expect(quotaFromHeaders({ "x-codex-primary-used-percent": "30" }, NOW)).toBeNull();
		expect(
			quotaFromHeaders(
				{ "anthropic-ratelimit-unified-5h-utilization": "n/a", "anthropic-ratelimit-unified-7d-utilization": "" },
				NOW,
			),
		).toBeNull();
	});

	it("reads the Codex WebSocket event", () => {
		const event = {
			type: "codex.rate_limits",
			plan_type: "pro",
			rate_limits: {
				secondary: { used_percent: 100, window_minutes: 10080, reset_at: 1792564227 },
				primary: { used_percent: 0, window_minutes: 300, reset_at: 0 },
			},
		};
		expect(quotaFromStreamEvent(event, NOW)).toEqual({
			source: "codex",
			windows: [
				{ minutes: 300, usedPercent: 0 },
				{ minutes: 10080, usedPercent: 100, resetsAt: 1_792_564_227_000 },
			],
			observedAt: NOW,
		});
		expect(quotaFromStreamEvent({ ...event, metered_limit_name: "codex" }, NOW)?.source).toBe("codex");
	});

	it("ignores other stream events and model-specific meters", () => {
		expect(quotaFromStreamEvent({ type: "response.output_text.delta", delta: "x" }, NOW)).toBeNull();
		expect(quotaFromStreamEvent(null, NOW)).toBeNull();
		expect(
			quotaFromStreamEvent(
				{
					type: "codex.rate_limits",
					metered_limit_name: "codex_bengalfox",
					rate_limits: { primary: { used_percent: 5, window_minutes: 300 } },
				},
				NOW,
			),
		).toBeNull();
		expect(quotaFromStreamEvent({ type: "codex.rate_limits", rate_limits: null }, NOW)).toBeNull();
	});
});

describe("PC-wide shared quota", () => {
	let dir = "";
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		vi.unstubAllEnvs();
	});
	const claude = (usedPercent: number, observedAt: number): SubscriptionQuota => ({
		source: "claude",
		windows: [{ minutes: 300, usedPercent, resetsAt: NOW + 3_600_000 }],
		observedAt,
	});

	it("keeps the newest snapshot per source and ignores invalid files", () => {
		dir = join(mkdtempSync(join(tmpdir(), "pimate-quota-")), "run");
		expect(readSharedQuotas(dir)).toEqual([]);
		writeSharedQuota(dir, claude(10, NOW));
		writeSharedQuota(dir, claude(5, NOW - 1));
		expect(readSharedQuotas(dir)).toEqual([claude(10, NOW)]);
		writeSharedQuota(dir, claude(20, NOW + 1));
		expect(readSharedQuotas(dir)).toEqual([claude(20, NOW + 1)]);
		writeFileSync(join(dir, "quota-codex.json"), JSON.stringify({ source: "claude", windows: [], observedAt: NOW }));
		expect(readSharedQuotas(dir).map((q) => q.source)).toEqual(["claude"]);
	});

	it("adopts only snapshots newer than this Pi's own, emitting each once", () => {
		dir = mkdtempSync(join(tmpdir(), "pimate-quota-"));
		vi.stubEnv("PIMATE_RUN_DIR", dir);
		const ours = new Hub();
		const other = new Hub();
		const emit = vi.spyOn(ours, "emit");
		ours.setQuota(claude(10, NOW));
		other.setQuota(claude(30, NOW + 5));
		ours.loadSharedQuotas();
		ours.loadSharedQuotas();
		expect(ours.snapshot().quotas).toEqual([claude(30, NOW + 5)]);
		expect(emit.mock.calls.map(([e]) => e)).toEqual([
			{ type: "quota", quota: claude(10, NOW) },
			{ type: "quota", quota: claude(30, NOW + 5) },
		]);
	});
});
