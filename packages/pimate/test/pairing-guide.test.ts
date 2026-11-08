import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parsePairingLink } from "@pimate/protocol";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { hintSetup, registerSetup } from "../src/extension/setup.ts";
import { HostConfig } from "../src/host/config.ts";
import {
	hasTailscaleAddress,
	pairedDeviceCount,
	pairingNotice,
	pairingProgress,
	pairingStatusLines,
	printable,
	SETUP_HINT,
} from "../src/host/pairing-guide.ts";
import { hostHealth } from "../src/host/service.ts";

vi.mock("../src/host/service.ts", async (original) => ({
	...(await original<typeof import("../src/host/service.ts")>()),
	hostHealth: vi.fn(),
}));

const dirs: string[] = [];
const temp = () => {
	const dir = mkdtempSync(join(tmpdir(), "pimate-pairing-"));
	dirs.push(dir);
	return dir;
};
const savedConfigDir = process.env.PIMATE_CONFIG_DIR;
beforeEach(() => {
	vi.mocked(hostHealth).mockReset();
});
afterEach(() => {
	vi.useRealTimers();
	if (savedConfigDir === undefined) delete process.env.PIMATE_CONFIG_DIR;
	else process.env.PIMATE_CONFIG_DIR = savedConfigDir;
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("names the app's scan button and explains a missing Tailscale address with the commands to recover", () => {
	expect(hasTailscaleAddress(["127.0.0.1", "100.101.102.103"])).toBe(true);
	expect(hasTailscaleAddress(["127.0.0.1", "fd7a:115c:a1e0::1"])).toBe(true);
	expect(hasTailscaleAddress(["127.0.0.1"])).toBe(false);
	const ok = pairingNotice(["127.0.0.1", "100.101.102.103", "fd7a:115c:a1e0::1"], 47800, "pimate://pair?x");
	expect(ok).toContain("Listening: 127.0.0.1:47800, 100.101.102.103:47800, [fd7a:115c:a1e0::1]:47800");
	expect(ok).toContain('tap "QRコードを読み取る"');
	expect(ok).toContain("pimate://pair?x");
	expect(ok).not.toContain("WARNING");
	const loopback = pairingNotice(["127.0.0.1"], 47800, "pimate://pair?x");
	expect(loopback).toContain("WARNING: No Tailscale address");
	expect(loopback).toContain("same account as the phone");
	expect(loopback).toContain("/pimate restart and /pimate pair");
});

it("reports a pairing only for this code's new device, and expiry otherwise", () => {
	const dir = temp();
	const config = new HostConfig(dir);
	const old = config.pair(config.createCode(), "Old phone");
	const before = new Set(config.devices().map((d) => d.deviceId));
	const expiresAt = Date.now() + 60_000;
	const code = config.createCode(expiresAt);
	const read = (now = Date.now()) =>
		pairingProgress({ codePending: config.codePending(code), before, devices: config.devices(), expiresAt, now });
	expect(read()).toEqual({ state: "waiting" });
	expect(read(expiresAt)).toEqual({ state: "expired" });
	config.pair(code, "Pixel\u001b[2J 8");
	expect(config.codePending(code)).toBe(false);
	expect(read()).toEqual({ state: "paired", name: "Pixel[2J 8" });
	expect(before.has(old.deviceId)).toBe(true);
	// A claimed but expired code adds no device.
	const late = config.createCode(Date.now() - 1);
	expect(() => config.pair(late, "Late")).toThrow("expired_code");
	const after = new Set(config.devices().map((d) => d.deviceId));
	expect(
		pairingProgress({
			codePending: config.codePending(late),
			before: after,
			devices: config.devices(),
			expiresAt: 0,
			now: 1,
		}),
	).toEqual({ state: "expired" });
	expect(printable("\u0007\u009b")).toBe("phone");
	expect(pairingStatusLines({ state: "paired", name: "Pixel 8" })[0]).toBe('Paired with "Pixel 8".');
	expect(pairingStatusLines({ state: "expired" })[0]).toContain("/pimate pair");
});

it("counts paired devices without creating the config directory", () => {
	const dir = join(temp(), "pimate");
	expect(pairedDeviceCount(dir)).toBe(0);
	expect(existsSync(dir)).toBe(false);
	const config = new HostConfig(dir);
	config.pair(config.createCode(), "Pixel 8");
	expect(pairedDeviceCount(dir)).toBe(1);
});

it("hints /pimate setup once per process, only in the PC TUI of an unpaired PC without a Host", async () => {
	const notify = vi.fn();
	const ctx = (mode: string) => ({ mode, ui: { notify } }) as unknown as ExtensionContext;
	const unpaired = { configDir: () => join(temp(), "none"), health: vi.fn(async () => undefined) };

	for (const mode of ["rpc", "json", "text"])
		await hintSetup(ctx(mode), { setupHinted: false, abducoSession: null }, unpaired);
	await hintSetup(ctx("tui"), { setupHinted: false, abducoSession: "pimate-1" }, unpaired);
	expect(unpaired.health).not.toHaveBeenCalled();

	const running = { ...unpaired, health: vi.fn(async () => ({ ok: true }) as never) };
	await hintSetup(ctx("tui"), { setupHinted: false, abducoSession: null }, running);
	expect(notify).not.toHaveBeenCalled();

	const dir = temp();
	const config = new HostConfig(dir);
	config.pair(config.createCode(), "Pixel 8");
	const paired = { configDir: () => dir, health: vi.fn(async () => undefined) };
	await hintSetup(ctx("tui"), { setupHinted: false, abducoSession: null }, paired);
	expect(paired.health).not.toHaveBeenCalled();

	const state = { setupHinted: false, abducoSession: null };
	await hintSetup(ctx("tui"), state, unpaired);
	await hintSetup(ctx("tui"), state, unpaired);
	expect(notify).toHaveBeenCalledTimes(1);
	expect(notify).toHaveBeenCalledWith(SETUP_HINT, "info");
});

it("the QR screen notices the phone's pairing, then shows the next step instead of the code", async () => {
	vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
	const dir = temp();
	process.env.PIMATE_CONFIG_DIR = dir;
	const config = new HostConfig(dir);
	vi.mocked(hostHealth).mockResolvedValue({
		ok: true,
		protocol: 1,
		hostId: config.host.hostId,
		addresses: [
			{ address: "127.0.0.1", port: 47800 },
			{ address: "100.101.102.103", port: 47800 },
		],
	} as never);
	const registerCommand = vi.fn();
	registerSetup({ registerCommand } as unknown as ExtensionAPI);
	const handler = registerCommand.mock.calls[0][1].handler;
	type Screen = { render(width: number): string[]; handleInput(data: string): void; dispose(): void };
	let screen: Screen | undefined;
	const requestRender = vi.fn();
	let closed = false;
	const custom = vi.fn(
		(factory: (tui: unknown, theme: unknown, kb: unknown, done: () => void) => Screen) =>
			new Promise<void>((resolve) => {
				screen = factory({ requestRender }, {}, {}, () => {
					closed = true;
					resolve();
				});
			}),
	);
	const running = handler("pair", { mode: "tui", ui: { custom, notify: vi.fn() } });
	await vi.waitFor(() => expect(screen).toBeDefined());
	const waiting = screen!.render(200).join("\n");
	expect(waiting).toContain('tap "QRコードを読み取る"');
	expect(waiting).toContain("Waiting for your phone");
	const link = parsePairingLink(/pimate:\/\/pair\?\S+/.exec(waiting)![0])!;
	expect(link.address).toBe("100.101.102.103:47800");

	vi.advanceTimersByTime(3000);
	expect(requestRender).not.toHaveBeenCalled();
	config.pair(link.code, "Pixel 8");
	vi.advanceTimersByTime(1000);
	expect(requestRender).toHaveBeenCalledTimes(1);
	const paired = screen!.render(200).join("\n");
	expect(paired).toContain('Paired with "Pixel 8".');
	expect(paired).not.toContain("pimate://pair");
	vi.advanceTimersByTime(5000);
	expect(requestRender).toHaveBeenCalledTimes(1);
	screen!.handleInput("\r");
	await running;
	expect(closed).toBe(true);
});
