/**
 * First-run guidance (docs/design: Onboarding): what the phone asks the user to do on the PC, where to get
 * Tailscale, and what the screen after the first pairing shows. Pure TS so the rules stay testable.
 */
import type { HostRuntime } from "./store";

export const PACKAGE_INSTALL_COMMAND = "pi install npm:@phni3j9a/pimate";
/** Installs the package, then starts Pi in the same terminal (`/pimate setup` runs inside Pi). */
export const PC_INSTALL_COMMANDS = `${PACKAGE_INSTALL_COMMAND}\npi`;
export const PC_SETUP_COMMAND = "/pimate setup";
export const PC_PAIR_COMMAND = "/pimate pair";
export const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
/** Tailscale's Android app needs Android 8.0 (API 26); PiMate itself installs from Android 7.0 (API 24). */
export const TAILSCALE_MIN_ANDROID_API = 26;

export interface TailscaleStore {
	/** The Tailscale app can run on this phone. */
	supported: boolean;
	label: string;
	/** Tried in order: the store app first, then its web page. */
	urls: string[];
}

export function tailscaleStore(os: string, androidApiLevel: number | null): TailscaleStore {
	if (os === "ios")
		return {
			supported: true,
			label: "App Store で Tailscale を開く",
			urls: ["https://apps.apple.com/app/tailscale/id1470499037"],
		};
	return {
		supported: androidApiLevel === null || androidApiLevel >= TAILSCALE_MIN_ANDROID_API,
		label: "Play ストアで Tailscale を開く",
		urls: ["market://details?id=com.tailscale.ipn", "https://play.google.com/store/apps/details?id=com.tailscale.ipn"],
	};
}

/** Sent to the PC with the share sheet, so the commands are pasted rather than typed. */
export function pcSetupMessage(): string {
	return [
		"PiMate: PC の準備",
		"",
		"1. ターミナルで PiMate を入れて、Pi を起動します",
		PACKAGE_INSTALL_COMMAND,
		"pi",
		"",
		"2. Pi の入力欄で実行します（最後に QR コードが表示されます）",
		PC_SETUP_COMMAND,
		"",
		"Node.js 22 以上と Pi 1.2.0 以上が必要です。PC とスマホを同じ Tailscale につないでください。",
	].join("\n");
}

export type FirstStepPhase = "loading" | "offline" | "empty" | "list";

/** The screen after the first pairing never says "no Pi" before the Host's list has arrived. */
export function firstStepPhase(host: Pick<HostRuntime, "state" | "instances" | "instancesReceived">): FirstStepPhase {
	if (host.state === "offline" || host.state === "auth_failed") return "offline";
	if (host.state !== "connected" || !host.instancesReceived) return "loading";
	return host.instances.length ? "list" : "empty";
}
