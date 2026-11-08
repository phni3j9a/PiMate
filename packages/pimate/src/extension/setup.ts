import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, Text } from "@earendil-works/pi-tui";
import { DEFAULT_HOST_PORT, formatPairingLink, HOST_PROTOCOL_VERSION, PROTOCOL_VERSION } from "@pimate/protocol";
import QRCode from "qrcode";
import { HostConfig, resolveConfigDir } from "../host/config.ts";
import { defaultListenAddresses, resolveAbduco } from "../host/index.ts";
import {
	hasTailscaleAddress,
	NO_TAILSCALE,
	PAIRING_CODE_TTL_MS,
	type PairingProgress,
	pairedDeviceCount,
	pairingNotice,
	pairingProgress,
	pairingStatusLines,
	SETUP_HINT,
} from "../host/pairing-guide.ts";
import {
	commandStatus,
	hasUserSystemd,
	hostHealth,
	installCommand,
	installService,
	removeCommand,
	serviceStatus,
	startHost,
	stopHost,
	uninstallService,
} from "../host/service.ts";
import { cliPath, PACKAGE_VERSION, packageDir } from "../package.ts";
import { getLocalUI } from "./ui.ts";

/** `pi install` keeps package bins off PATH, so `pimate attach` shown on the phone needs this link. */
async function offerCommand(ctx: ExtensionCommandContext): Promise<void> {
	if (process.platform === "win32") return;
	const ui = getLocalUI(ctx);
	const cmd = commandStatus();
	if (cmd.conflict) {
		ui.notify(
			`${cmd.path} exists and is not PiMate's link; left unchanged. Run ${cliPath} directly instead.`,
			"warning",
		);
		return;
	}
	if (!cmd.linked) {
		if (
			!(await ui.confirm(
				"Add the pimate command?",
				`Link ${cmd.path} -> ${cliPath} so commands shown on the phone (pimate attach …) work in a terminal? Shell config files are not changed.`,
			))
		)
			return;
		installCommand();
		ui.notify(`Installed ${cmd.path}`, "info");
	}
	if (!cmd.onPath)
		ui.notify(
			`${cmd.dir} is not on PATH. Add this to your shell config, then open a new terminal:\nexport PATH="${cmd.dir}:$PATH"`,
			"warning",
		);
}

async function pair(ctx: ExtensionCommandContext): Promise<void> {
	const ui = getLocalUI(ctx);
	const health = await hostHealth();
	if (!health) throw new Error("Host is stopped. Run /pimate setup or /pimate start first.");
	const config = new HostConfig();
	if (health.hostId !== config.host.hostId) throw new Error("Another/older Host is on port 47800; stop it first.");
	const addresses = health.addresses?.map((a) => a.address) ?? ["127.0.0.1"];
	const address =
		addresses.find((a) => a.startsWith("100.")) ?? addresses.find((a) => a.startsWith("fd7a:")) ?? "127.0.0.1";
	const before = new Set(config.devices().map((device) => device.deviceId));
	const expiresAt = Date.now() + PAIRING_CODE_TTL_MS;
	const code = config.createCode(expiresAt);
	const link = formatPairingLink({
		address: `${address.includes(":") ? `[${address}]` : address}:${DEFAULT_HOST_PORT}`,
		code,
		...config.host,
		hostName: config.host.name,
	});
	const qr = await QRCode.toString(link, { type: "utf8", errorCorrectionLevel: "L" });
	const notice = pairingNotice(addresses, DEFAULT_HOST_PORT, link);
	await ui.custom<void>((tui, _theme, _kb, done) => {
		// The Host pairs in its own process; watch the shared config for this code's device.
		let progress: PairingProgress = { state: "waiting" };
		const check = () => {
			try {
				progress = pairingProgress({
					codePending: config.codePending(code),
					before,
					devices: config.devices(),
					expiresAt,
					now: Date.now(),
				});
			} catch {
				return; // devices.json is being replaced: look again on the next tick
			}
			if (progress.state === "waiting") return;
			clearInterval(timer);
			tui.requestRender();
		};
		const timer = setInterval(check, 1000);
		timer.unref();
		const text = (lines: string[], width: number) => new Text(lines.join("\n"), 0, 0).render(width);
		return {
			render(width) {
				// Once used or expired, the code is worthless: show the outcome instead of the QR.
				if (progress.state !== "waiting") return text(pairingStatusLines(progress), width);
				const lines = qr.trimEnd().split("\n");
				return [
					...text([notice], width),
					...(width >= Math.max(...lines.map((line) => line.length))
						? lines
						: text(["Widen the terminal to show the QR, or use the link above."], width)),
					...text(pairingStatusLines(progress), width),
				];
			},
			handleInput(data) {
				if (!matchesKey(data, Key.enter) && !matchesKey(data, Key.escape)) return;
				clearInterval(timer);
				done();
			},
			invalidate() {},
			dispose() {
				clearInterval(timer);
			},
		};
	});
}
/**
 * After `pi install`, nothing tells a PC user about `/pimate setup`. A PC TUI Pi says it once per process while
 * no phone has ever paired and no Host runs; it never creates config files or starts anything.
 */
export function hintSetup(
	ctx: ExtensionContext,
	state: { setupHinted: boolean; abducoSession: string | null },
	deps = { configDir: resolveConfigDir, health: hostHealth },
): Promise<void> {
	if (ctx.mode !== "tui" || state.setupHinted || state.abducoSession) return Promise.resolve();
	state.setupHinted = true;
	if (pairedDeviceCount(deps.configDir()) > 0) return Promise.resolve();
	return deps.health().then((health) => {
		if (health) return;
		try {
			getLocalUI(ctx).notify(SETUP_HINT, "info");
		} catch {
			// The session was replaced meanwhile (/new, /resume): its context is gone.
		}
	});
}

export function registerSetup(pi: ExtensionAPI): void {
	pi.registerCommand("pimate", {
		description: "PiMate: setup, pair, devices, status, start, stop, restart, uninstall (PC only)",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/pimate is available only in the PC TUI", "error");
				return;
			}
			const ui = getLocalUI(ctx);
			try {
				switch (args.trim() || "status") {
					case "setup": {
						const status = await serviceStatus();
						if (await hostHealth()) {
							await offerCommand(ctx);
							if (await ui.confirm("PiMate is already running", "Create another phone pairing?")) await pair(ctx);
							return;
						}
						const tailscale = hasTailscaleAddress(await defaultListenAddresses());
						if (
							!(await ui.confirm(
								"Set up PiMate",
								`Start a Host listening on loopback and this PC's Tailscale addresses, then create a private phone pairing code? Paired devices can control Pi. No LAN/public listener is opened.${tailscale ? "" : `\n\n${NO_TAILSCALE}. You can continue now and pair later with /pimate restart and /pimate pair.`}`,
							))
						)
							return;
						if (status.installed) {
							await startHost();
						} else if (
							(await hasUserSystemd()) &&
							(await ui.confirm(
								"Register systemd user service?",
								`Create pimate-host.service and enable --now (starts at login; survives Pi exit)? Linger=${status.linger}. Linger is NOT changed. Choose No to start only for now, without installing a service.`,
							))
						) {
							await installService();
						} else {
							ui.notify(
								"Starting for now, without service registration. Non-Linux service registration is unsupported; detached fallback may stop at logout.",
								"info",
							);
							await startHost();
						}
						await offerCommand(ctx);
						await pair(ctx);
						return;
					}
					case "pair":
						await pair(ctx);
						return;
					case "devices": {
						const config = new HostConfig();
						const devices = config.devices();
						if (!devices.length) {
							ui.notify("No paired devices", "info");
							return;
						}
						const labels = devices.map(
							(d) =>
								`${d.name} — ${d.deviceId} (last seen: ${d.lastSeenAt ? new Date(d.lastSeenAt).toISOString() : "never"})`,
						);
						const chosen = await ui.select("Paired devices — select to revoke, Esc to close", labels);
						if (chosen && (await ui.confirm("Revoke device?", chosen))) {
							config.revoke(devices[labels.indexOf(chosen)].deviceId);
							ui.notify("Device revoked", "info");
						}
						return;
					}
					case "status": {
						const health = await hostHealth();
						const service = await serviceStatus();
						const cmd = commandStatus();
						ui.notify(
							`PiMate Extension ${PACKAGE_VERSION} / RC protocol ${PROTOCOL_VERSION}\nHost: ${health ? `${health.version ?? "unknown"} / protocol ${health.protocol} / RC ${health.rcProtocol ?? "unknown"}` : "stopped"}\nService: installed=${service.installed}, active=${service.active}, linger=${service.linger}\nListen: ${health?.addresses?.map((a) => `${a.address.includes(":") ? `[${a.address}]` : a.address}:${a.port}`).join(", ") ?? "unknown"}\nabduco (Host): ${health?.abduco ?? "unknown/unavailable"}\nabduco (this package): ${resolveAbduco(process.env, packageDir, (message) => ui.notify(message, "warning")) ?? "unavailable (install system abduco)"}\nSkipped incompatible RCs: ${JSON.stringify(health?.incompatible ?? {})}\nCommand: ${cmd.path} (${cmd.linked ? "linked" : cmd.conflict ? "other file, not PiMate's" : "not installed; run /pimate setup"}${cmd.onPath ? "" : ", directory not on PATH"})`,
							"info",
						);
						if (
							health &&
							(health.version !== PACKAGE_VERSION ||
								health.protocol !== HOST_PROTOCOL_VERSION ||
								health.rcProtocol !== PROTOCOL_VERSION)
						) {
							if (
								await ui.confirm(
									"Host / extension version mismatch",
									"Restart Host with the current package? Existing phone connections will reconnect.",
								)
							) {
								await stopHost();
								if (service.installed) await installService();
								else await startHost();
							}
						}
						return;
					}
					case "start":
						if (
							!(await hostHealth()) &&
							!(await ui.confirm("Start PiMate Host?", "Listen on loopback + Tailscale and accept paired phones?"))
						)
							return;
						await startHost();
						ui.notify("Host started", "info");
						return;
					case "stop":
						await stopHost();
						ui.notify("Host stopped (any installed login service is kept)", "info");
						return;
					case "restart":
						if (await ui.confirm("Restart Host?", "Disconnect phones briefly and use this installed PiMate version?")) {
							const installed = (await serviceStatus()).installed;
							await stopHost();
							if (installed) await installService();
							else await startHost();
							ui.notify("Host restarted", "info");
						}
						return;
					case "uninstall":
						if (
							await ui.confirm(
								"Remove PiMate Host service?",
								"Stop Host and remove its systemd user unit and PiMate's pimate command link. Paired device config and the Pi package are kept.",
							)
						) {
							await uninstallService();
							removeCommand();
							ui.notify(
								`Host service and pimate command link removed. Run: pi remove npm:@phni3j9a/pimate\nThen optionally delete ${resolveConfigDir()} to forget all pairings. For local installs use pi remove <installed-directory>.`,
								"info",
							);
						}
						return;
					default:
						ui.notify("Usage: /pimate setup|pair|devices|status|start|stop|restart|uninstall", "info");
				}
			} catch (error) {
				ui.notify(String(error), "error");
			}
		},
	});
}
