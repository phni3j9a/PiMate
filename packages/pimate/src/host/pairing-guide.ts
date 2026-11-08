/**
 * What the PC says while a phone pairs: where the phone connects, what to tap in the app, and whether the
 * code has been used. Shared by `/pimate setup|pair` (PC TUI) and the `pimate pair` CLI.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Device } from "./config.ts";

/** Pairing codes are single use and valid this long (HostConfig.createCode). */
export const PAIRING_CODE_TTL_MS = 10 * 60_000;
/** The app's scan button (apps/mobile/src/app/pair.tsx), so the PC can name it. */
export const APP_SCAN_BUTTON = "QRコードを読み取る";
export const SETUP_HINT = "PiMate: run /pimate setup to use this Pi from your phone.";

export function formatAddress(address: string): string {
	return address.includes(":") ? `[${address}]` : address;
}

/** The phone reaches the Host over Tailscale only; loopback alone means it cannot connect. */
export function hasTailscaleAddress(addresses: readonly string[]): boolean {
	return addresses.some((a) => a.startsWith("100.") || a.toLowerCase().startsWith("fd7a:"));
}

export const NO_TAILSCALE =
	"No Tailscale address on this PC, so the phone cannot connect. Install Tailscale here and log in with the same account as the phone";

/** Text above the QR code in the PC TUI. */
export function pairingNotice(addresses: readonly string[], port: number, link: string): string {
	return [
		`Listening: ${addresses.map((a) => `${formatAddress(a)}:${port}`).join(", ")}`,
		...(hasTailscaleAddress(addresses) ? [] : [`WARNING: ${NO_TAILSCALE}, then run /pimate restart and /pimate pair.`]),
		`On your phone, open PiMate, tap "${APP_SCAN_BUTTON}" (Scan QR code) and scan this code.`,
		"Single use; expires in 10 minutes. Keep this link private.",
		link,
		"",
	].join("\n");
}

export type PairingProgress = { state: "waiting" } | { state: "paired"; name: string } | { state: "expired" };

/**
 * Paired: the code was consumed and a device that was not there before appeared. A code that was
 * claimed after it expired adds no device and reads as expired.
 */
export function pairingProgress(input: {
	codePending: boolean;
	before: ReadonlySet<string>;
	devices: readonly Device[];
	expiresAt: number;
	now: number;
}): PairingProgress {
	if (!input.codePending) {
		const added = input.devices.find((device) => !input.before.has(device.deviceId));
		if (added) return { state: "paired", name: printable(added.name) };
	}
	return input.now >= input.expiresAt ? { state: "expired" } : { state: "waiting" };
}

/** The phone chose its name; never let it write terminal control sequences. */
export function printable(text: string): string {
	return text.replace(/\p{Cc}/gu, "").slice(0, 80) || "phone";
}

/** Lines under the QR code while waiting, or in its place once the code is used or has expired. */
export function pairingStatusLines(progress: PairingProgress): string[] {
	if (progress.state === "paired")
		return [
			`Paired with "${progress.name}".`,
			"Next, on your phone: open a running Pi, or start a new one.",
			"",
			"Enter / Esc: close",
		];
	if (progress.state === "expired")
		return ["This code expired without being used. Run /pimate pair for a new one.", "", "Enter / Esc: close"];
	return ["Waiting for your phone… Enter / Esc: dismiss (the code stays valid until used or expired)"];
}

/** Read-only (no config files are created): Pi start uses it to decide on SETUP_HINT. */
export function pairedDeviceCount(configDir: string): number {
	try {
		const devices: unknown = JSON.parse(readFileSync(join(configDir, "devices.json"), "utf8"));
		return Array.isArray(devices) ? devices.length : 0;
	} catch {
		return 0;
	}
}
