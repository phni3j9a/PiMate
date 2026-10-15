import type { PiAlert } from "@pimate/protocol";
import { expect, it, vi } from "vitest";
import { MemoryStorage } from "../src/lib/hostRegistry";
import { NotificationCenter, notificationTarget } from "../src/lib/notifications";

const alert: PiAlert = { id: "i:2", instanceId: "i", sessionId: "s", kind: "input" };
async function setup() {
	const storage = new MemoryStorage();
	const deps = {
		storage,
		permission: vi.fn(async (_request: boolean) => "granted" as const),
		watch: vi.fn(),
		visible: vi.fn(() => false),
		show: vi.fn(async () => {}),
		clear: vi.fn(async () => {}),
	};
	const center = new NotificationCenter(deps);
	await center.init();
	return { center, deps };
}
it("defaults off, never asks permission on startup, persists opt-in", async () => {
	const { center, deps } = await setup();
	expect(center.getState().settings.enabled).toBe(false);
	expect(deps.permission).toHaveBeenCalledWith(false);
	await center.receive("h", alert);
	expect(deps.show).not.toHaveBeenCalled();
	await center.update("enabled", true);
	expect(deps.permission).toHaveBeenCalledWith(true);
	const restored = new NotificationCenter(deps);
	await restored.init();
	expect(restored.getState().settings.enabled).toBe(true);
});
it("deduplicates, filters categories and visible chat; payload is generic and text-free", async () => {
	const { center, deps } = await setup();
	await center.update("enabled", true);
	await center.receive("h", alert);
	await center.receive("h", alert);
	expect(deps.show).toHaveBeenCalledTimes(1);
	expect(deps.show).toHaveBeenCalledWith("Pi が入力を待っています", { hostId: "h", instanceId: "i", sessionId: "s" });
	await center.update("input", false);
	await center.receive("h", { ...alert, id: "3", kind: "child_paused" });
	expect(deps.show).toHaveBeenCalledTimes(1);
	deps.visible.mockReturnValue(true);
	await center.receive("h", { ...alert, id: "4", kind: "complete" });
	expect(deps.show).toHaveBeenCalledTimes(1);
	await center.update("enabled", false);
	expect(deps.clear).toHaveBeenCalled();
});
it("permission failure and invalid payloads cannot crash chat", async () => {
	const { center, deps } = await setup();
	await center.update("enabled", true);
	deps.permission.mockRejectedValueOnce(new Error("denied"));
	await center.refreshPermission();
	await center.receive("h", alert);
	expect(deps.show).not.toHaveBeenCalled();
	expect(deps.watch).toHaveBeenLastCalledWith(false);
	for (const value of [
		null,
		{},
		{ hostId: "h", instanceId: 5, sessionId: "s" },
		{ hostId: "h", instanceId: "i", sessionId: "" },
	])
		expect(notificationTarget(value)).toBeNull();
});
it("failed delivery is contained and does not replay the alert", async () => {
	const { center, deps } = await setup();
	await center.update("enabled", true);
	deps.show.mockRejectedValueOnce(new Error("OS error"));
	await center.receive("h", alert);
	await center.receive("h", alert);
	expect(center.getState().error).not.toBe("");
	expect(deps.show).toHaveBeenCalledTimes(1);
});
