#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { DEFAULT_HOST_PORT, formatPairingLink } from "@pimate/protocol";
import QRCode from "qrcode";
import { atomicWrite, HostConfig, resolveConfigDir } from "./config.ts";
import { HostCore, parseAbducoList } from "./index.ts";
import { defaultListenAddresses, HostServer } from "./server.ts";
import { conversation, lastAssistant, type TurnResult, TurnWatch } from "./turn.ts";
import {
	markAnswered,
	off,
	payload,
	post,
	readWebhookConfig,
	setupInput,
	setWatch,
	unmarkAnswered,
	watches,
	webhookError,
} from "./webhook.ts";

const usage =
	"Usage: pimate serve [--port N] [--listen ADDR]... | pair [--address host:port] [--port N] | devices | revoke <deviceId> | list | attach [abducoSession] | spawn --cwd <dir> [-- pi args] | prompt <id> <text|-> [--steer|--follow-up] [--wait [--timeout S]] | wait <id> [--timeout S] | abort <id> | history <id> [--last N] | watch <id> | ui <id> <requestId> <value|--confirm|--cancel|--answers JSON> | webhook <setup|test|status|off|watch|unwatch>";
async function main(): Promise<void> {
	const [command, ...args] = process.argv.slice(2);
	if (command === "--help" || command === "-h") {
		console.log(usage);
		return;
	}
	if (["serve", "pair", "devices", "revoke"].includes(command)) {
		const config = new HostConfig();
		if (command === "devices") {
			console.log(
				JSON.stringify(
					config.devices().map(({ tokenHash: _, ...device }) => device),
					null,
					2,
				),
			);
			return;
		}
		if (command === "revoke") {
			if (args.length !== 1) throw new Error(usage);
			config.revoke(args[0]);
			console.log("Device revoked");
			return;
		}
		let port = DEFAULT_HOST_PORT;
		let address: string | undefined;
		const listen: string[] = [];
		for (let i = 0; i < args.length; i += 2) {
			if (!args[i + 1]) throw new Error(usage);
			if (args[i] === "--port") {
				port = Number(args[i + 1]);
				if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
			} else if (command === "serve" && args[i] === "--listen") listen.push(args[i + 1]);
			else if (command === "pair" && args[i] === "--address") address = args[i + 1];
			else throw new Error(usage);
		}
		if (command === "pair") {
			address ??= `${(await defaultListenAddresses()).find((ip) => ip.startsWith("100.")) ?? "127.0.0.1"}:${port}`;
			if (!/^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):\d{1,5}$/.test(address))
				throw new Error("Invalid pairing address (host:port required)");
			const link = formatPairingLink({
				address,
				code: config.createCode(),
				hostId: config.host.hostId,
				hostName: config.host.name,
			});
			console.log(link);
			console.log(await QRCode.toString(link, { type: "terminal", small: true }));
			console.log("Single use; expires in 10 minutes. Keep this code private.");
			return;
		}
		const server = new HostServer({ port, listen: listen.length ? listen : undefined });
		for (const bound of await server.start())
			console.log(
				`Listening http://${bound.address.includes(":") ? `[${bound.address}]` : bound.address}:${bound.port}`,
			);
		console.log(`Paired devices: ${config.devices().length}`);
		await new Promise<void>((resolve) => {
			process.once("SIGINT", resolve);
			process.once("SIGTERM", resolve);
		});
		await server.close();
		return;
	}
	const host = new HostCore();
	const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
	if (command === "webhook") {
		const config = new HostConfig();
		const [action, ...rest] = args;
		if (action === "setup") {
			if (rest.length && (rest.length !== 2 || rest[0] !== "--machine")) throw new Error(usage);
			atomicWrite(join(config.dir, "webhook.json"), await setupInput(process.stdin, rest[1]));
			console.log("saved webhook.json");
		} else if (action === "status" && !rest.length) {
			const saved = readWebhookConfig(config.dir);
			print({ configured: !!saved, machine: saved?.machine ?? null, watched: watches(config.dir) });
		} else if (action === "off" && !rest.length) {
			off(config.dir);
			console.log("webhook off");
		} else if ((action === "watch" || action === "unwatch") && rest.length === 1) {
			const existing = new Set((await host.list()).map((i) => i.instanceId));
			if (action === "watch" && !existing.has(rest[0])) throw new Error("NOT_FOUND");
			setWatch(config.dir, rest[0], action === "watch");
			print({ watched: watches(config.dir).filter((id) => existing.has(id)) });
		} else if (action === "test" && !rest.length) {
			const saved = readWebhookConfig(config.dir);
			if (!saved) throw new Error("WEBHOOK_NOT_CONFIGURED");
			const result = await post(saved, payload(saved, "test", "", null, "", "", String(Date.now())));
			if (!result.ok)
				throw new Error(
					result.status
						? `WEBHOOK_REJECTED HTTP ${result.status}${result.status === 401 || result.status === 403 ? " (key changed, run setup again)" : ""}`
						: `WEBHOOK_UNREACHABLE ${result.code}`,
				);
			print({ ok: true, status: result.status });
		} else throw new Error(usage);
		return;
	}
	if (command === "list") {
		print(await host.list());
		return;
	}
	if (command === "attach") {
		if (!host.abduco) throw new Error("abduco not found; set PIMATE_ABDUCO or build the bundled binary");
		if (args.length > 1) throw new Error(usage);
		console.log("Detach: Ctrl+\\ (Pi keeps running)");
		const sessions = parseAbducoList(spawnSync(host.abduco, [], { encoding: "utf8", env: host.env }).stdout ?? "");
		if (!args[0]) {
			print(sessions);
			return;
		}
		if (!sessions.some((s) => s.name === args[0])) throw new Error("Unknown abduco session");
		const code = await new Promise<number>((resolve, reject) => {
			const child = spawn(host.abduco!, ["-a", args[0]], { env: host.env, stdio: "inherit" });
			child.once("error", reject);
			child.once("exit", (code) => resolve(code ?? 1));
		});
		process.exitCode = code;
		return;
	}
	if (command === "spawn") {
		const separator = args.indexOf("--");
		const flags = separator < 0 ? args : args.slice(0, separator);
		if (flags.length !== 2 || flags[0] !== "--cwd") throw new Error(usage);
		print(await host.spawn({ cwd: flags[1], args: separator < 0 ? [] : args.slice(separator + 1) }));
		return;
	}
	if (!["prompt", "wait", "abort", "history", "watch", "ui"].includes(command) || !args[0]) throw new Error(usage);
	const client = host.client(args[0]);
	const rest = args.slice(1);
	const flag = (name: string) => {
		const i = rest.indexOf(name);
		if (i >= 0) rest.splice(i, 1);
		return i >= 0;
	};
	const option = (name: string, fallback: number) => {
		if (!rest.includes(name)) return fallback;
		const value = Number(rest.splice(rest.indexOf(name), 2)[1]);
		if (!Number.isInteger(value) || value < 1) throw new Error(usage);
		return value;
	};
	// Parse prompt args (and read stdin) before connecting: events buffered while stdin blocks would look like
	// they followed our prompt. Then only one local round-trip separates hello from the prompt.
	const steer = command === "prompt" && flag("--steer");
	const follow = command === "prompt" && flag("--follow-up");
	const wait = command === "prompt" && flag("--wait");
	const timeout = command === "prompt" || command === "wait" ? option("--timeout", 300) : 300;
	// `-` reads stdin, so multi-line prompts need no shell quoting.
	const text = command === "prompt" && rest.join(" ") === "-" ? readFileSync(0, "utf8").trimEnd() : rest.join(" ");
	if (command === "prompt" && (!text || (steer && follow))) throw new Error(usage);
	// Listen before connecting: a turn may settle while hello is in flight.
	const watch = new TurnWatch(command !== "prompt");
	const ended = new Promise<TurnResult>((resolve) => {
		client.onEvent((message) => {
			const result = watch.next(message);
			if (result) resolve(result);
		});
		client.onClose(() => resolve(watch.result("closed")));
	});
	const until = (seconds: number) =>
		Promise.race([ended, sleep(seconds * 1000, undefined, { ref: false }).then(() => watch.result("timeout"))]);
	const settled = async (result: TurnResult) =>
		result.outcome === "done" && !result.reply && !result.error
			? watch.settledFrom((await client.request("history", {})).items)
			: result;
	try {
		const snapshot = await client.connect();
		const early = watch.start(snapshot);
		switch (command) {
			case "prompt": {
				const result = await client.request("prompt", {
					text,
					deliverAs: steer ? "steer" : follow ? "followUp" : undefined,
				});
				if (!wait || result.deliveredAs === "command") {
					print(result);
					break;
				}
				const held = watch.arm(result.deliveredAs !== "prompt");
				print({ ...result, ...(await settled(held ?? (await until(timeout)))) });
				break;
			}
			case "wait": {
				if (rest.length) throw new Error(usage);
				if (early) print(await settled(early));
				else if (snapshot.status === "idle")
					print(watch.result("idle", lastAssistant((await client.request("history", {})).items)));
				else print(await settled(await until(timeout)));
				break;
			}
			case "abort":
				print(await client.request("abort", {}));
				break;
			case "history": {
				const last = option("--last", 0);
				if (rest.length) throw new Error(usage);
				const history = await client.request("history", {});
				print(last ? conversation(history.items).slice(-last) : history);
				break;
			}
			case "ui": {
				if (!args[1] || args[2] === undefined) throw new Error(usage);
				const answers = args[2] === "--answers" ? JSON.parse(args[3] ?? "null") : undefined;
				if (args[2] === "--answers" && (!Array.isArray(answers) || args.length !== 4)) throw new Error(usage);
				const dir = resolveConfigDir();
				let marker: string | undefined;
				try {
					marker = markAnswered(dir, args[0], args[1]);
				} catch {
					webhookError("write answered-here.json");
				}
				try {
					print(
						await client.request("ui_respond", {
							requestId: args[1],
							...(answers
								? { answers }
								: args[2] === "--cancel"
									? { cancelled: true }
									: args[2] === "--confirm"
										? { confirmed: true }
										: { value: args.slice(2).join(" ") }),
						}),
					);
				} catch (error) {
					if (marker !== undefined)
						try {
							unmarkAnswered(dir, args[0], args[1], marker);
						} catch {
							webhookError("remove answered-here marker");
						}
					throw error;
				}
				break;
			}
			case "watch": {
				client.onEvent(print);
				await new Promise<void>((resolve) => {
					process.once("SIGINT", resolve);
					process.once("SIGTERM", resolve);
				});
				break;
			}
		}
	} finally {
		client.close();
	}
}
main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
