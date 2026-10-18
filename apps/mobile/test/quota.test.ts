import type { HostMessage, InstanceSnapshot, SubscriptionQuota } from "@pimate/protocol";
import { describe, expect, it } from "vitest";
import { createView, reduceView } from "../src/lib/instanceView";
import { nextQuotaReset, quotaGroups, quotaWindowLabel, timeLeft } from "../src/lib/sessionInfo";

const ID = "inst-1";
const snapshot = (patch: Partial<InstanceSnapshot> = {}): InstanceSnapshot => ({
	protocol: 1,
	instanceId: ID,
	pid: 1,
	cwd: "/w",
	origin: "pc",
	abducoSession: null,
	startedAt: 0,
	session: { id: "s1" },
	status: "idle",
	model: null,
	thinking: null,
	pendingUI: [],
	seq: 1,
	...patch,
});
const subscribed = (patch: Partial<InstanceSnapshot> = {}): HostMessage => ({
	type: "subscribed",
	instanceId: ID,
	snapshot: snapshot(patch),
	history: { session: { id: "s1" }, items: [] },
});
const quota = (source: SubscriptionQuota["source"], usedPercent: number, observedAt = 1): SubscriptionQuota => ({
	source,
	windows: [{ minutes: 300, usedPercent }],
	observedAt,
});
const event = (q: SubscriptionQuota, seq: number): HostMessage => ({
	type: "event",
	instanceId: ID,
	sessionId: "s1",
	seq,
	event: { type: "quota", quota: q },
});

describe("subscription quota view", () => {
	it("distinguishes an old RC from one that has seen nothing yet", () => {
		expect(reduceView(createView(ID), subscribed(), 0).quotas).toBeNull();
		expect(reduceView(createView(ID), subscribed({ quotas: [] }), 0).quotas).toEqual([]);
	});

	it("replaces a source's quota and keeps the others", () => {
		let v = reduceView(createView(ID), subscribed({ quotas: [quota("claude", 10)] }), 0);
		v = reduceView(v, event(quota("codex", 0), 2), 0);
		v = reduceView(v, event(quota("claude", 40, 2), 3), 0);
		expect(v.quotas).toEqual([quota("codex", 0), quota("claude", 40, 2)]);
		// Events also reach an RC view that started without quota support (after the PC update + reload).
		expect(reduceView(reduceView(createView(ID), subscribed(), 0), event(quota("codex", 5), 2), 0).quotas).toEqual([
			quota("codex", 5),
		]);
	});

	it("labels windows and hides figures whose reset has passed", () => {
		expect([300, 10080, 1440, 90].map(quotaWindowLabel)).toEqual(["5時間", "週間", "1日", "90分"]);
		const now = new Date(2026, 9, 17, 10, 52).getTime();
		const groups = quotaGroups(
			[
				{
					source: "codex",
					observedAt: now,
					windows: [
						{ minutes: 300, usedPercent: 12.4, resetsAt: new Date(2026, 9, 17, 15, 53).getTime() },
						{ minutes: 10080, usedPercent: 100, resetsAt: new Date(2026, 9, 24, 10, 3).getTime() },
					],
				},
				{
					source: "claude",
					observedAt: now - 3 * 3_600_000,
					windows: [
						{ minutes: 300, usedPercent: 90, resetsAt: now - 1 },
						{ minutes: 10080, usedPercent: 65 },
					],
				},
			],
			now,
		);
		expect(groups.map((g) => g.name)).toEqual(["Claude", "Codex"]);
		// The ring follows the 5h window, even when 7d is higher or 5h has just reset.
		expect(groups.map((g) => g.gauge)).toEqual([null, 12]);
		// Without a 5h window (ChatGPT Pro), the weekly one.
		expect(
			quotaGroups([{ source: "codex", observedAt: now, windows: [{ minutes: 10080, usedPercent: 40 }] }], now)[1]
				?.gauge,
		).toBe(40);
		expect(groups[0]).toMatchObject({
			observed: "7:52 取得",
			windows: [
				{ label: "5時間", percent: null, reset: "リセット済み・次の応答で更新" },
				{ label: "週間", percent: 65, reset: "リセット日時不明" },
			],
		});
		expect(groups[1]?.windows).toMatchObject([
			{ percent: 12, reset: "15:53 にリセット（あと5時間1分）" },
			{ percent: 100, reset: "10/24 10:03 にリセット（あと6日23時間）" },
		]);
		expect(nextQuotaReset(null, now)).toBeNull();
	});

	it("keeps both rings even when a source is unseen or fully reset, never as 0%", () => {
		const now = 1_000_000;
		for (const quotas of [
			null,
			[],
			[{ source: "codex" as const, observedAt: 1, windows: [{ minutes: 300, usedPercent: 50, resetsAt: now }] }],
		]) {
			const groups = quotaGroups(quotas, now);
			expect(groups.map((g) => [g.source, g.gauge])).toEqual([
				["claude", null],
				["codex", null],
			]);
		}
		expect(quotaGroups([], now)[0]).toMatchObject({ observed: null, windows: [] });
		expect(
			nextQuotaReset(
				[quota("claude", 1), { ...quota("codex", 1), windows: [{ minutes: 300, usedPercent: 1, resetsAt: now + 9 }] }],
				now,
			),
		).toBe(now + 9);
		expect([1, 59 * 60_000, 60 * 60_000, 25 * 3_600_000].map((ms) => timeLeft(now + ms, now))).toEqual([
			"あと1分",
			"あと59分",
			"あと1時間",
			"あと1日1時間",
		]);
	});
});
