import { describe, expect, it } from "vitest";
import {
	firstStepPhase,
	PACKAGE_INSTALL_COMMAND,
	PC_SETUP_COMMAND,
	pcSetupMessage,
	TAILSCALE_MIN_ANDROID_API,
	tailscaleStore,
} from "../src/lib/onboarding";
import { pairingErrorMessage } from "../src/lib/pairing";

describe("setup guidance", () => {
	it("points to the Tailscale store and blocks Android versions Tailscale does not support", () => {
		expect(TAILSCALE_MIN_ANDROID_API).toBe(26);
		expect(tailscaleStore("android", 26)).toEqual({
			supported: true,
			label: "Play ストアで Tailscale を開く",
			urls: [
				"market://details?id=com.tailscale.ipn",
				"https://play.google.com/store/apps/details?id=com.tailscale.ipn",
			],
		});
		expect(tailscaleStore("android", 25).supported).toBe(false);
		expect(tailscaleStore("android", null).supported).toBe(true);
		expect(tailscaleStore("ios", null)).toMatchObject({
			supported: true,
			urls: ["https://apps.apple.com/app/tailscale/id1470499037"],
		});
	});

	it("tells the PC side the public package and /pimate setup, never the bare pimate CLI", () => {
		expect(PACKAGE_INSTALL_COMMAND).toBe("pi install npm:@phni3j9a/pimate");
		expect(PC_SETUP_COMMAND).toBe("/pimate setup");
		const message = pcSetupMessage();
		expect(message).toContain("pi install npm:@phni3j9a/pimate\npi\n");
		expect(message).toContain("/pimate setup");
		expect(message).not.toMatch(/pimate (serve|pair|revoke)/);
	});

	it("pairing errors name the in-Pi commands that exist after /pimate setup", () => {
		for (const kind of ["invalid_code", "expired_code"] as const)
			expect(pairingErrorMessage(kind, "100.64.0.2:47800")).toContain("/pimate pair");
		const unreachable = pairingErrorMessage("unreachable", "100.64.0.2:47800");
		expect(unreachable).toContain("100.64.0.2:47800");
		expect(unreachable).toContain("Tailscale");
		expect(unreachable).toContain("/pimate status");
		expect(unreachable).not.toContain("pimate serve");
	});
});

describe("first step after pairing", () => {
	const host = (state: string, instances: unknown[], instancesReceived: boolean) =>
		({ state, instances, instancesReceived }) as Parameters<typeof firstStepPhase>[0];

	it("waits for the Host's Pi list before choosing between the list and starting a new Pi", () => {
		expect(firstStepPhase(host("connecting", [], false))).toBe("loading");
		expect(firstStepPhase(host("idle", [], false))).toBe("loading");
		expect(firstStepPhase(host("connected", [], false))).toBe("loading");
		expect(firstStepPhase(host("connected", [], true))).toBe("empty");
		expect(firstStepPhase(host("connected", [{ instanceId: "i1" }], true))).toBe("list");
		expect(firstStepPhase(host("offline", [], true))).toBe("offline");
		expect(firstStepPhase(host("auth_failed", [], false))).toBe("offline");
	});
});
