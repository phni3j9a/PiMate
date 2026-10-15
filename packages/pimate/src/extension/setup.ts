import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, Text } from "@earendil-works/pi-tui";
import { DEFAULT_HOST_PORT, formatPairingLink, HOST_PROTOCOL_VERSION, PROTOCOL_VERSION } from "@pimate/protocol";
import QRCode from "qrcode";
import { HostConfig, resolveConfigDir } from "../host/config.ts";
import { resolveAbduco } from "../host/index.ts";
import {
	hasUserSystemd,
	hostHealth,
	installService,
	serviceStatus,
	startHost,
	stopHost,
	uninstallService,
} from "../host/service.ts";
import { PACKAGE_VERSION, packageDir } from "../package.ts";
import { getLocalUI } from "./ui.ts";

async function pair(ctx: ExtensionCommandContext): Promise<void> {
	const ui = getLocalUI(ctx);
	const health = await hostHealth();
	if (!health) throw new Error("Host is stopped. Run /pimate setup or /pimate start first.");
	const config = new HostConfig();
	if (health.hostId !== config.host.hostId) throw new Error("Another/older Host is on port 47800; stop it first.");
	const addresses = health.addresses?.map((a) => a.address) ?? ["127.0.0.1"];
	const address =
		addresses.find((a) => a.startsWith("100.")) ?? addresses.find((a) => a.startsWith("fd7a:")) ?? "127.0.0.1";
	const link = formatPairingLink({
		address: `${address.includes(":") ? `[${address}]` : address}:${DEFAULT_HOST_PORT}`,
		code: config.createCode(),
		...config.host,
		hostName: config.host.name,
	});
	const qr = await QRCode.toString(link, { type: "utf8", errorCorrectionLevel: "L" });
	const notice = `Listening: ${addresses.map((a) => `${a.includes(":") ? `[${a}]` : a}:${DEFAULT_HOST_PORT}`).join(", ")}\n${addresses.length === 1 ? "WARNING: No Tailscale address. Phone cannot connect over loopback; start Tailscale and restart Host.\n" : ""}Scan on your phone (single use; expires in 10 minutes). Keep this link private.\n${link}\n\n`;
	await ui.custom<void>((_tui, _theme, _kb, done) => ({
		render(width) {
			const lines = qr.trimEnd().split("\n");
			return [
				...new Text(notice, 0, 0).render(width),
				...(width >= Math.max(...lines.map((line) => line.length))
					? lines
					: new Text("Widen the terminal to show the QR, or use the link above.", 0, 0).render(width)),
				...new Text("Enter / Esc: dismiss (code remains valid until used/expired)", 0, 0).render(width),
			];
		},
		handleInput(data) {
			if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) done();
		},
		invalidate() {},
	}));
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
							if (await ui.confirm("PiMate is already running", "Create another phone pairing?")) await pair(ctx);
							return;
						}
						if (
							!(await ui.confirm(
								"Set up PiMate",
								"Start a Host listening on loopback and this PC's Tailscale addresses, then create a private phone pairing code? Paired devices can control Pi. No LAN/public listener is opened.",
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
						ui.notify(
							`PiMate Extension ${PACKAGE_VERSION} / RC protocol ${PROTOCOL_VERSION}\nHost: ${health ? `${health.version ?? "unknown"} / protocol ${health.protocol} / RC ${health.rcProtocol ?? "unknown"}` : "stopped"}\nService: installed=${service.installed}, active=${service.active}, linger=${service.linger}\nListen: ${health?.addresses?.map((a) => `${a.address.includes(":") ? `[${a.address}]` : a.address}:${a.port}`).join(", ") ?? "unknown"}\nabduco (Host): ${health?.abduco ?? "unknown/unavailable"}\nabduco (this package): ${resolveAbduco(process.env, packageDir, (message) => ui.notify(message, "warning")) ?? "unavailable (install system abduco)"}\nSkipped incompatible RCs: ${JSON.stringify(health?.incompatible ?? {})}`,
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
								"Stop Host and remove its systemd user unit. Paired device config and the Pi package are kept.",
							)
						) {
							await uninstallService();
							ui.notify(
								`Host service removed. Run: pi remove npm:pimate\nThen optionally delete ${resolveConfigDir()} to forget all pairings. For local installs use pi remove <installed-directory>.`,
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
