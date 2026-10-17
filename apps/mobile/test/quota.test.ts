import type { HostMessage, InstanceSnapshot, SubscriptionQuota } from "@pimate/protocol";
import { describe, expect, it } from "vitest";
import { createView, reduceView } from "../src/lib/instanceView";
import { quotaGroups, quotaWindowLabel } from "../src/lib/sessionInfo";

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
		expect(groups[0]).toMatchObject({
			observed: "7:52 取得",
			windows: [
				{ label: "5時間", percent: null, reset: "リセット済み・次の応答で更新" },
				{ label: "週間", percent: 65, reset: "リセット日時不明" },
			],
		});
		expect(groups[1]?.windows).toMatchObject([
			{ percent: 12, reset: "15:53 にリセット" },
			{ percent: 100, reset: "10/24 10:03 にリセット" },
		]);
	});
});
